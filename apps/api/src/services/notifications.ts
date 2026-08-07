import { env } from "../lib/env";

type DeliveryResult = {
  sent: boolean;
  provider: string;
  messageId?: string;
  attempts?: number;
};

type ReminderPayload = {
  customerName: string;
  customerEmail: string;
  scheduledDateIso: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

type OverduePayload = ReminderPayload & {
  hoursOverdue: number;
};

function requireResendApiKey(): string {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required when NOTIFICATION_PROVIDER=resend");
  }

  return env.RESEND_API_KEY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function shouldRetryResendStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function getRetryDelayMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

async function sendViaResend(args: {
  to: string[];
  subject: string;
  html: string;
}): Promise<DeliveryResult> {
  const apiKey = requireResendApiKey();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.NOTIFICATION_FROM_EMAIL,
      to: args.to,
      subject: args.subject,
      html: args.html
    })
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const details = bodyText ? `: ${bodyText}` : "";
    const error = new Error(`Resend send failed with status ${response.status}${details}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const payload = (await response.json()) as { id?: string };
  return {
    sent: true,
    provider: "resend",
    messageId: payload.id
  };
}

function sendViaMock(args: { to: string[]; subject: string; html: string }): DeliveryResult {
  console.log("[mock-notify]", {
    to: args.to,
    subject: args.subject,
    html: args.html
  });

  return {
    sent: true,
    provider: "mock",
    messageId: `mock-${Date.now()}`,
    attempts: 1
  };
}

async function sendViaResendWithRetry(args: {
  to: string[];
  subject: string;
  html: string;
}): Promise<DeliveryResult> {
  const maxRetries = env.NOTIFICATION_MAX_RETRIES;
  const baseDelayMs = env.NOTIFICATION_RETRY_BASE_DELAY_MS;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    attempt += 1;

    try {
      const result = await sendViaResend(args);
      return {
        ...result,
        attempts: attempt
      };
    } catch (error: unknown) {
      lastError = error;
      const status =
        error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
          ? ((error as { status: number }).status)
          : null;

      const canRetry = status !== null ? shouldRetryResendStatus(status) : true;
      const isLastAttempt = attempt > maxRetries;
      if (!canRetry || isLastAttempt) {
        throw error;
      }

      const delayMs = getRetryDelayMs(attempt, baseDelayMs);
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Resend send failed after retries");
}

async function sendEmail(args: {
  to: string[];
  subject: string;
  html: string;
}): Promise<DeliveryResult> {
  if (env.NOTIFICATION_PROVIDER === "resend") {
    return sendViaResendWithRetry(args);
  }

  return sendViaMock(args);
}

export async function sendPickupReminder(payload: ReminderPayload): Promise<DeliveryResult> {
  return sendEmail({
    to: [payload.customerEmail],
    subject: "Garbage Pail Pals pickup reminder",
    html: `
      <p>Hi ${payload.customerName},</p>
      <p>Your can service is scheduled soon:</p>
      <ul>
        <li>Time: ${payload.scheduledDateIso}</li>
        <li>Address: ${payload.addressLine1}, ${payload.city}, ${payload.state} ${payload.postalCode}</li>
      </ul>
      <p>Please place cans out before the service window.</p>
    `
  });
}

export async function sendOverdueAlert(payload: OverduePayload): Promise<DeliveryResult> {
  const recipients = [payload.customerEmail];
  if (env.NOTIFICATION_ESCALATION_EMAIL) {
    recipients.push(env.NOTIFICATION_ESCALATION_EMAIL);
  }

  return sendEmail({
    to: recipients,
    subject: "Garbage Pail Pals overdue service alert",
    html: `
      <p>Service alert for ${payload.customerName}.</p>
      <ul>
        <li>Address: ${payload.addressLine1}, ${payload.city}, ${payload.state} ${payload.postalCode}</li>
        <li>Scheduled time: ${payload.scheduledDateIso}</li>
        <li>Overdue: ~${payload.hoursOverdue} hours</li>
      </ul>
      <p>The operations team has been notified.</p>
    `
  });
}
