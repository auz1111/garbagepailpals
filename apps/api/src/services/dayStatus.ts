import { prisma } from "@gpp/db";
import type { DayStatusIssue, DayStatusProvider, DayStatusResponse } from "@gpp/shared";
import { defaultOperatingZone, serviceDateForZone } from "../lib/timezone";
import {
  reconcileTodaysWork,
  type ActionProviderStatus,
  type ReconciledWork,
  type WorkScope
} from "./todaysWork";

// Severity order so a provider's rollup reflects its worst location today.
const PROVIDER_RANK: Record<DayStatusProvider["status"], number> = {
  NORMAL: 0,
  UNKNOWN: 1,
  SHIFTED: 2,
  NO_COLLECTION: 3
};

// The worst provider-status across an address's two roll actions (for rollup).
function worstAddressStatus(r: ReconciledWork): DayStatusProvider["status"] | null {
  const map = (s: ActionProviderStatus): DayStatusProvider["status"] | null => {
    if (s === "NORMAL") return "NORMAL";
    if (s === "UNKNOWN") return "UNKNOWN";
    if (s === "SHIFTED") return "SHIFTED";
    if (s === "NO_COLLECTION") return "NO_COLLECTION";
    return null; // NOT_SYNCED contributes nothing to provider health
  };
  const candidates = [map(r.rollOut.providerStatus), map(r.rollIn.providerStatus)].filter(
    (s): s is DayStatusProvider["status"] => s !== null
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => PROVIDER_RANK[b] - PROVIDER_RANK[a])[0]!;
}

// Compute the admin "is today on track?" summary for a service-area scope:
// provider health, route coverage (scheduled → assigned → accepted → serviced),
// and a list of concrete issues, all from the same holiday-aware reconciliation
// that builds the routes.
export async function computeDayStatus(scope: WorkScope, now = new Date()): Promise<DayStatusResponse> {
  const reconciled = await reconcileTodaysWork(now, scope);
  const serviceDate = serviceDateForZone(now, defaultOperatingZone());

  // Locations with actual roll work due today (this is what routes should cover).
  const due = reconciled.filter((r) => r.rollOut.due || r.rollIn.due);
  const dueIds = new Set(due.map((r) => r.address.id));

  // Provider-shifted/skipped locations whose NORMAL day is today but that are
  // NOT due (used to flag routes that shouldn't run today).
  const notDueProviderNotes = reconciled.filter(
    (r) => !r.rollOut.due && !r.rollIn.due
  );

  // Today's persisted route stops (any operator) for these locations, plus their
  // route status + serviced state.
  const relevantIds = [
    ...new Set([...dueIds, ...notDueProviderNotes.map((r) => r.address.id)])
  ];
  const stops =
    relevantIds.length > 0
      ? await prisma.routeStop.findMany({
          where: { serviceAddressId: { in: relevantIds }, route: { serviceDate } },
          select: {
            serviceAddressId: true,
            servicedAt: true,
            route: { select: { status: true } }
          }
        })
      : [];
  const stopByAddress = new Map(stops.map((s) => [s.serviceAddressId, s]));

  // ---- Coverage counts (over due locations) ----
  let assigned = 0;
  let accepted = 0;
  let serviced = 0;
  const issues: DayStatusIssue[] = [];

  for (const r of due) {
    const stop = stopByAddress.get(r.address.id);
    if (!stop) {
      issues.push({
        type: "UNASSIGNED",
        addressId: r.address.id,
        line1: r.address.line1,
        detail: `${r.address.line1} is scheduled today but not on any route.`
      });
      continue;
    }
    assigned += 1;
    const status = stop.route.status;
    if (status === "ACCEPTED" || status === "COMPLETED") accepted += 1;
    if (stop.servicedAt) {
      serviced += 1;
    } else if (status === "ASSIGNED") {
      issues.push({
        type: "AWAITING_ACCEPTANCE",
        addressId: r.address.id,
        line1: r.address.line1,
        detail: `${r.address.line1} is on a route awaiting operator acceptance.`
      });
    } else if (status === "ACCEPTED") {
      issues.push({
        type: "UNSERVICED",
        addressId: r.address.id,
        line1: r.address.line1,
        detail: `${r.address.line1} is accepted but not serviced yet.`
      });
    }
  }

  // ---- Routes that shouldn't run today (provider skipped/shifted this week) ----
  for (const r of notDueProviderNotes) {
    const stop = stopByAddress.get(r.address.id);
    if (!stop) continue;
    const skipped =
      r.rollOut.providerStatus === "NO_COLLECTION" || r.rollIn.providerStatus === "NO_COLLECTION";
    issues.push({
      type: "ROUTED_BUT_SKIPPED",
      addressId: r.address.id,
      line1: r.address.line1,
      detail: skipped
        ? `${r.address.line1} is on a route today, but ${r.provider.label ?? "the provider"} isn't collecting this week — refresh to rebuild.`
        : `${r.address.line1} is on a route today, but ${r.provider.label ?? "the provider"} shifted this pickup — refresh to rebuild.`
    });
  }

  // ---- Per-provider health rollup ----
  const provMap = new Map<string, { label: string; status: DayStatusProvider["status"]; affected: number }>();
  for (const r of reconciled) {
    const st = worstAddressStatus(r);
    if (st === null) continue;
    // A synced location with no cached provider row still surfaces as Unknown
    // under a synthetic bucket so it's never silently treated as on-schedule.
    const id = r.provider.id ?? (st === "UNKNOWN" ? "__unconfirmed__" : null);
    if (!id) continue;
    const entry = provMap.get(id) ?? {
      label: r.provider.label ?? "Trash provider (unconfirmed)",
      status: "NORMAL" as DayStatusProvider["status"],
      affected: 0
    };
    if (PROVIDER_RANK[st] > PROVIDER_RANK[entry.status]) entry.status = st;
    if (st !== "NORMAL") entry.affected += 1;
    provMap.set(id, entry);
  }
  const providers: DayStatusProvider[] = [...provMap.entries()]
    .map(([id, v]) => ({ id, label: v.label, status: v.status, affected: v.affected }))
    .sort((a, b) => PROVIDER_RANK[b.status] - PROVIDER_RANK[a.status]);

  // Provider issues (add-on to the per-location coverage issues above).
  for (const p of providers) {
    if (p.status === "NO_COLLECTION") {
      issues.push({
        type: "PROVIDER_NO_COLLECTION",
        addressId: null,
        line1: null,
        detail: `${p.label}: no collection this week (holiday) — ${p.affected} location${p.affected === 1 ? "" : "s"} affected.`
      });
    } else if (p.status === "SHIFTED") {
      issues.push({
        type: "PROVIDER_SHIFTED",
        addressId: null,
        line1: null,
        detail: `${p.label}: pickups shifted this week — ${p.affected} location${p.affected === 1 ? "" : "s"} affected.`
      });
    } else if (p.status === "UNKNOWN") {
      issues.push({
        type: "PROVIDER_UNKNOWN",
        addressId: null,
        line1: null,
        detail: `${p.label}: no cached schedule for ${p.affected} location${p.affected === 1 ? "" : "s"} — refresh to confirm today.`
      });
    }
  }

  const coverage = {
    scheduled: due.length,
    assigned,
    accepted,
    serviced,
    unassigned: due.length - assigned
  };

  // ---- Headline ----
  const offSchedule =
    providers.some((p) => p.status === "NO_COLLECTION") ||
    issues.some((i) => i.type === "ROUTED_BUT_SKIPPED");
  const needsAttention =
    coverage.unassigned > 0 ||
    issues.some((i) => i.type === "AWAITING_ACCEPTANCE") ||
    providers.some((p) => p.status === "UNKNOWN" || p.status === "SHIFTED") ||
    coverage.serviced < coverage.scheduled;
  const headline: DayStatusResponse["headline"] = offSchedule
    ? "OFF_SCHEDULE"
    : needsAttention
      ? "NEEDS_ATTENTION"
      : "ON_TRACK";

  return { date: now.toISOString(), headline, providers, coverage, issues };
}
