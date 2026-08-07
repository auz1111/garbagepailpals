import { prisma } from "@gpp/db";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function registerWebhookEvent(
  provider: string,
  externalEventId: string,
  payload: unknown
): Promise<{ duplicate: boolean; webhookEventId?: string }> {
  try {
    const created = await prisma.webhookEvent.create({
      data: {
        provider,
        externalEventId,
        payload: payload as object
      }
    });

    return { duplicate: false, webhookEventId: created.id };
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return { duplicate: true };
    }

    throw error;
  }
}

export async function markWebhookProcessed(webhookEventId: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      processedAt: new Date()
    }
  });
}

export async function processWebhookIdempotently(args: {
  provider: string;
  externalEventId: string;
  payload: unknown;
  handler: () => Promise<void>;
}): Promise<{ duplicate: boolean }> {
  return processWebhookIdempotentlyWithRegistrar({
    provider: args.provider,
    externalEventId: args.externalEventId,
    payload: args.payload,
    register: registerWebhookEvent,
    markProcessed: markWebhookProcessed,
    handler: args.handler
  });
}

export async function processWebhookIdempotentlyWithRegistrar(args: {
  provider: string;
  externalEventId: string;
  payload: unknown;
  register: (provider: string, externalEventId: string, payload: unknown) => Promise<{ duplicate: boolean; webhookEventId?: string }>;
  markProcessed: (webhookEventId: string) => Promise<void>;
  handler: () => Promise<void>;
}): Promise<{ duplicate: boolean }> {
  const registration = await args.register(args.provider, args.externalEventId, args.payload);
  if (registration.duplicate || !registration.webhookEventId) {
    return { duplicate: true };
  }

  try {
    await args.handler();
    await args.markProcessed(registration.webhookEventId);
  } catch (error: unknown) {
    console.error("Webhook processing failed", {
      provider: args.provider,
      eventId: args.externalEventId,
      error
    });
  }

  return { duplicate: false };
}
