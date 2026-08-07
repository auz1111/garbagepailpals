import { env } from "../lib/env";

type DeliveryResult = {
  sent: boolean;
  provider: string;
  messageId?: string;
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
    throw new Error(`Resend send failed with status ${response.status}`);
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
    messageId: `mock-${Date.now()}`
  };
}

async function sendEmail(args: {
  to: string[];
  subject: string;
  html: string;
}): Promise<DeliveryResult> {
  if (env.NOTIFICATION_PROVIDER === "resend") {
    return sendViaResend(args);
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
