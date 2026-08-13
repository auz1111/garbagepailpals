import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { HaulerUpcoming } from "@gpp/shared";
import { calculateJobsForAddress, shouldRunForAddressNow } from "./scheduler";

const weekly = (day: number, rollIn = true) => ({
  pickupDayOfWeek: day,
  cadence: "WEEKLY" as const,
  biweeklyAnchorDate: null,
  curbOutOffsetHours: -12,
  rollIn
});

const garbage = (dates: string[]): HaulerUpcoming["pickups"] =>
  dates.map((date) => ({ date, kind: "GARBAGE" as const }));

describe("calculateJobsForAddress", () => {
  it("creates curb-out and curb-in jobs for matching weekly dates", () => {
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(2)],
      [],
      [],
      7,
      new Date("2026-08-10T12:00:00.000Z")
    );

    expect(jobs.length).toBe(2);
    expect(jobs[0]?.type).toBe("CURB_OUT");
    expect(jobs[1]?.type).toBe("CURB_IN");
  });

  it("omits the roll-in job when the day opts out of roll-in", () => {
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(2, false)],
      [],
      [],
      7,
      new Date("2026-08-10T12:00:00.000Z")
    );

    expect(jobs.length).toBe(1);
    expect(jobs[0]?.type).toBe("CURB_OUT");
  });

  it("creates jobs for every configured pickup day", () => {
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(1), weekly(4)],
      [],
      [],
      7,
      new Date("2026-08-10T12:00:00.000Z")
    );

    // Two days, each producing a curb-out + curb-in within the week.
    expect(jobs.length).toBe(4);
  });

  it("suppresses jobs when a service hold covers the service day", () => {
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(2)],
      [
        {
          startDate: new Date("2026-08-11T00:00:00.000Z"),
          endDate: new Date("2026-08-11T23:59:59.000Z")
        }
      ],
      [],
      7,
      new Date("2026-08-10T12:00:00.000Z")
    );

    expect(jobs.length).toBe(0);
  });

  it("applies holiday shiftDays before weekday matching", () => {
    const base = DateTime.fromISO("2026-09-08T10:00:00", { zone: "America/Los_Angeles" });
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(1)],
      [],
      [
        {
          municipality: "Bend",
          date: base.minus({ days: 1 }).toUTC().toJSDate(),
          shiftDays: 1
        }
      ],
      3,
      base.toUTC().toJSDate()
    );

    expect(jobs.length).toBe(2);
  });

  it("only emits jobs on matching biweekly windows", () => {
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [
        {
          pickupDayOfWeek: 4,
          cadence: "BIWEEKLY",
          biweeklyAnchorDate: new Date("2026-08-06T00:00:00.000Z"),
          curbOutOffsetHours: -12,
          rollIn: true
        }
      ],
      [],
      [],
      21,
      new Date("2026-08-03T12:00:00.000Z")
    );

    expect(jobs.length).toBe(4);
  });

  // Reference Monday 2026-08-31; Thursday pickups fall on 9/3, 9/10, 9/17.
  const REF = new Date("2026-08-31T12:00:00.000Z");
  const THURSDAY = 4;

  it("shifts a pickup to the hauler's holiday-adjusted date", () => {
    // The 9/7 (Labor Day) week moves Thursday 9/10 → Friday 9/11.
    const upcoming: HaulerUpcoming = {
      from: "2026-08-31",
      to: "2026-10-15",
      pickups: garbage(["2026-09-03", "2026-09-11", "2026-09-17", "2026-09-24"])
    };
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(THURSDAY)],
      [],
      [],
      21,
      REF,
      upcoming
    );

    const curbOuts = jobs.filter((j) => j.type === "CURB_OUT");
    expect(curbOuts.length).toBe(3); // 9/3, 9/10→9/11, 9/17
    const shifted = curbOuts.filter((j) => j.shiftReason);
    expect(shifted.length).toBe(1);
    expect(shifted[0]?.status).toBe("SCHEDULED");
    expect(shifted[0]?.shiftedFromDate).toBeTruthy();
    // The shifted curb-out is one day later than the normal Thursday curb-out.
    const normalWeek = curbOuts.find(
      (j) => !j.shiftReason && DateTime.fromJSDate(j.scheduledDate).day <= 3
    );
    expect(shifted[0]!.scheduledDate.getTime()).toBeGreaterThan(normalWeek!.scheduledDate.getTime());
  });

  it("marks a week the hauler skips as a SKIPPED job with no roll-in", () => {
    // No garbage date in the 9/7 week → cancelled.
    const upcoming: HaulerUpcoming = {
      from: "2026-08-31",
      to: "2026-10-15",
      pickups: garbage(["2026-09-03", "2026-09-17", "2026-09-24"])
    };
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(THURSDAY)],
      [],
      [],
      21,
      REF,
      upcoming
    );

    const skipped = jobs.filter((j) => j.status === "SKIPPED");
    expect(skipped.length).toBe(1);
    expect(skipped[0]?.type).toBe("CURB_OUT");
    expect(skipped[0]?.shiftReason).toMatch(/no collection/i);
    // Normal weeks (9/3, 9/17) still produce curb-out + curb-in; the skip has no roll-in.
    expect(jobs.filter((j) => j.status === "SCHEDULED").length).toBe(4);
  });

  it("falls back to the normal date beyond the hauler data window", () => {
    // Coverage ends 9/6, so 9/10 and 9/17 fall back to normal (no skip).
    const upcoming: HaulerUpcoming = {
      from: "2026-08-31",
      to: "2026-09-06",
      pickups: garbage(["2026-09-03"])
    };
    const jobs = calculateJobsForAddress(
      "sub_1",
      "addr_1",
      "America/Los_Angeles",
      [weekly(THURSDAY)],
      [],
      [],
      21,
      REF,
      upcoming
    );

    expect(jobs.filter((j) => j.status === "SKIPPED").length).toBe(0);
    expect(jobs.filter((j) => j.type === "CURB_OUT").length).toBe(3); // 9/3, 9/10, 9/17 all normal
    expect(jobs.filter((j) => j.shiftReason).length).toBe(0);
  });

  it("runs only when local timezone hour is 02:00", () => {
    const shouldRun = shouldRunForAddressNow("America/Los_Angeles", new Date("2026-08-10T09:15:00.000Z"));
    const shouldSkip = shouldRunForAddressNow("America/Los_Angeles", new Date("2026-08-10T13:15:00.000Z"));

    expect(shouldRun).toBe(true);
    expect(shouldSkip).toBe(false);
  });
});
