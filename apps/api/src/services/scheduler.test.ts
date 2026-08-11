import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { calculateJobsForAddress, shouldRunForAddressNow } from "./scheduler";

const weekly = (day: number, rollIn = true) => ({
  pickupDayOfWeek: day,
  cadence: "WEEKLY" as const,
  biweeklyAnchorDate: null,
  curbOutOffsetHours: -12,
  rollIn
});

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

  it("runs only when local timezone hour is 02:00", () => {
    const shouldRun = shouldRunForAddressNow("America/Los_Angeles", new Date("2026-08-10T09:15:00.000Z"));
    const shouldSkip = shouldRunForAddressNow("America/Los_Angeles", new Date("2026-08-10T13:15:00.000Z"));

    expect(shouldRun).toBe(true);
    expect(shouldSkip).toBe(false);
  });
});
