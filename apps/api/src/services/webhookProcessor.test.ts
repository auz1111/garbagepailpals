import { describe, expect, it, vi } from "vitest";
import { processWebhookIdempotentlyWithRegistrar } from "./webhookProcessor";

type FakeStore = Record<string, string>;

function createRegistrar(store: FakeStore) {
  return async (provider: string, eventId: string): Promise<{ duplicate: boolean; webhookEventId?: string }> => {
    const key = `${provider}:${eventId}`;
    if (store[key]) {
      return { duplicate: true };
    }

    const webhookEventId = `we_${Object.keys(store).length + 1}`;
    store[key] = webhookEventId;
    return { duplicate: false, webhookEventId };
  };
}

describe("webhook idempotency", () => {
  it("stripe duplicate event is ignored", async () => {
    const store: FakeStore = {};
    const handler = vi.fn(async () => undefined);
    const markProcessed = vi.fn(async () => undefined);
    const register = createRegistrar(store);

    const first = await processWebhookIdempotentlyWithRegistrar({
      provider: "stripe",
      externalEventId: "evt_stripe_1",
      payload: { id: "evt_stripe_1" },
      register,
      markProcessed,
      handler
    });

    const second = await processWebhookIdempotentlyWithRegistrar({
      provider: "stripe",
      externalEventId: "evt_stripe_1",
      payload: { id: "evt_stripe_1" },
      register,
      markProcessed,
      handler
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });

  it("paypal duplicate event is ignored", async () => {
    const store: FakeStore = {};
    const handler = vi.fn(async () => undefined);
    const markProcessed = vi.fn(async () => undefined);
    const register = createRegistrar(store);

    const first = await processWebhookIdempotentlyWithRegistrar({
      provider: "paypal",
      externalEventId: "evt_paypal_1",
      payload: { id: "evt_paypal_1" },
      register,
      markProcessed,
      handler
    });

    const second = await processWebhookIdempotentlyWithRegistrar({
      provider: "paypal",
      externalEventId: "evt_paypal_1",
      payload: { id: "evt_paypal_1" },
      register,
      markProcessed,
      handler
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });
});
