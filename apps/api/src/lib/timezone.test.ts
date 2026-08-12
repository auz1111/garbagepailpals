import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  biweeklyMatchesZoned,
  isValidZone,
  resolveZone,
  serviceDateForZone,
  timezoneForCoords,
  weekdayInZone,
  zonedDay
} from "./timezone";

const key = (d: Date) => d.toISOString().slice(0, 10);

describe("serviceDateForZone", () => {
  it("resolves the operating day in the location's zone, not the server clock", () => {
    // 2026-08-12T04:00:00Z is still Aug 11 (9pm) in Pacific. A UTC host would
    // wrongly call it Aug 12 — this is the exact bug the fix addresses.
    const now = new Date("2026-08-12T04:00:00Z");
    expect(key(serviceDateForZone(now, "America/Los_Angeles"))).toBe("2026-08-11");
    expect(key(serviceDateForZone(now, "UTC"))).toBe("2026-08-12");
  });

  it("differs across zones for the same instant near midnight", () => {
    // 04:30Z → Pacific is Aug 11 21:30, Eastern is Aug 12 00:30.
    const now = new Date("2026-08-12T04:30:00Z");
    expect(key(serviceDateForZone(now, "America/Los_Angeles"))).toBe("2026-08-11");
    expect(key(serviceDateForZone(now, "America/New_York"))).toBe("2026-08-12");
  });

  it("is stable across a DST spring-forward boundary", () => {
    // US DST began 2026-03-08. An instant on that local day still keys to Mar 8.
    const now = new Date("2026-03-08T18:00:00Z"); // 10am/11am PT
    expect(key(serviceDateForZone(now, "America/Los_Angeles"))).toBe("2026-03-08");
  });
});

describe("weekdayInZone / zonedDay", () => {
  it("uses JS getDay convention (0=Sun..6=Sat) in the given zone", () => {
    const now = new Date("2026-08-12T04:00:00Z"); // Aug 11 (Tue) in Pacific
    expect(weekdayInZone(now, "America/Los_Angeles", 0)).toBe(2); // Tue
    expect(weekdayInZone(now, "America/Los_Angeles", 1)).toBe(3); // roll-out → Wed
    expect(weekdayInZone(now, "America/Los_Angeles", -1)).toBe(1); // roll-in → Mon
    // Same instant, UTC host would think it's already Wed (Aug 12).
    expect(weekdayInZone(now, "UTC", 0)).toBe(3);
  });

  it("zonedDay returns the shifted local day start", () => {
    const now = new Date("2026-08-12T04:00:00Z");
    const tomorrow = zonedDay(now, "America/Los_Angeles", 1);
    expect(tomorrow.toISODate()).toBe("2026-08-12");
  });
});

describe("biweeklyMatchesZoned", () => {
  it("matches even week counts from the anchor and rejects odd", () => {
    const anchor = new Date("2026-01-06T00:00:00Z"); // week 0
    const zone = "America/Los_Angeles";
    const week0 = DateTime.fromISO("2026-01-06", { zone });
    const week1 = DateTime.fromISO("2026-01-13", { zone });
    const week2 = DateTime.fromISO("2026-01-20", { zone });
    expect(biweeklyMatchesZoned(anchor, week0)).toBe(true);
    expect(biweeklyMatchesZoned(anchor, week1)).toBe(false);
    expect(biweeklyMatchesZoned(anchor, week2)).toBe(true);
  });

  it("returns false with no anchor", () => {
    expect(biweeklyMatchesZoned(null, DateTime.now())).toBe(false);
  });
});

describe("timezoneForCoords", () => {
  it("resolves US coordinates to their IANA zone", () => {
    expect(timezoneForCoords(44.0582, -121.3153)).toBe("America/Los_Angeles"); // Bend, OR
    expect(timezoneForCoords(40.7128, -74.006)).toBe("America/New_York"); // NYC
    expect(timezoneForCoords(39.7392, -104.9903)).toBe("America/Denver"); // Denver
  });

  it("falls back to the default zone on invalid coordinates", () => {
    expect(timezoneForCoords(1000, 1000)).toBe("America/Los_Angeles");
  });
});

describe("zone validation", () => {
  it("validates IANA zones", () => {
    expect(isValidZone("America/New_York")).toBe(true);
    expect(isValidZone("Not/AZone")).toBe(false);
  });

  it("resolveZone falls back to default for missing/invalid", () => {
    expect(resolveZone("America/New_York")).toBe("America/New_York");
    expect(resolveZone(null)).toBe("America/Los_Angeles");
    expect(resolveZone("bogus")).toBe("America/Los_Angeles");
  });
});
