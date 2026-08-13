import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type {
  CurrentUser,
  ServiceAddress,
  PickupDay,
  PickupDayInput,
  PickupScheduleSuggestion,
  PricingDay,
  ScheduleCan
} from "@gpp/shared";
import {
  addressMonthlyCents,
  cansToCadence,
  cansToCanCount,
  formatUsd,
  petWasteMonthlyCents,
  pickupDayMonthlyCents,
  PRICING
} from "@gpp/shared";
import {
  ApiError,
  checkServiceArea,
  connectProvider,
  confirmPayPalSubscription,
  createPayPalSubscription,
  createStripeCheckout,
  createStripePortal,
  getBillingSummary,
  updateSubscription,
  listAddresses,
  listHistoryJobs,
  listUpcomingJobs,
  deleteAddress,
  updateAddress,
  updateAddressSchedule
} from "../lib/api";
import { ProviderSyncReview } from "./ProviderSyncReview";
import { AddLocationWizard } from "./AddLocationWizard";
import { CanRowsEditor } from "./CanRowsEditor";

// A schedule row from the API mapped to the shared pricing input.
function toPricingDay(day: PickupDay): PricingDay {
  return {
    cans: day.cans,
    rollIn: day.rollIn,
    petWasteDogs: day.petWasteDogs
  };
}

type CustomerWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
  refreshUser: () => Promise<void>;
};


function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

const DEFAULT_PICKUP_DAYS = [5];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

export const CUSTOMER_NAV = [
  { to: "/customer", label: "Dashboard", icon: "🧭", end: true },
  { to: "/customer/jobs", label: "My Routes", icon: "🚚" },
  { to: "/customer/addresses", label: "My Locations", icon: "🏠" },
  { to: "/customer/history", label: "History", icon: "🕓" },
  { to: "/customer/billing", label: "Billing", icon: "💳" }
] as const;

export function CustomerWorkspace({ user, accessToken, refreshUser }: CustomerWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [finalizingCheckout, setFinalizingCheckout] = useState(false);
  // The add-address form is hidden once the user has addresses (opened via a button).
  const [showAddressForm, setShowAddressForm] = useState(false);

  function closeAddressForm(): void {
    // The add-location wizard owns its own form state; just hide it.
    setShowAddressForm(false);
  }

  const addressesQuery = useQuery({
    queryKey: ["customer-addresses"],
    queryFn: async () => listAddresses(accessToken)
  });

  const billingSummaryQuery = useQuery({
    queryKey: ["customer-billing-summary"],
    queryFn: async () => getBillingSummary(accessToken)
  });

  // Job feeds are entitlement-gated (402 without an active plan), so only fetch
  // them once billing confirms the plan is active — no wasted 402s for unpaid
  // accounts.
  const hasActivePlan = billingSummaryQuery.data?.active === true;
  const upcomingJobsQuery = useQuery({
    queryKey: ["customer-jobs-upcoming"],
    queryFn: async () => listUpcomingJobs(accessToken),
    enabled: hasActivePlan
  });

  const historyJobsQuery = useQuery({
    queryKey: ["customer-jobs-history"],
    queryFn: async () => listHistoryJobs(accessToken),
    enabled: hasActivePlan
  });

  const deleteAddressMutation = useMutation({
    mutationFn: (id: string) => deleteAddress(id, accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-jobs-upcoming"] });
    }
  });

  const updateSubscriptionMutation = useMutation({
    mutationFn: () =>
      updateSubscription(accessToken, {
        returnUrl: `${window.location.origin}/customer/billing?checkout=success`,
        cancelUrl: `${window.location.origin}/customer/billing?checkout=cancel`
      }),
    onSuccess: (data) => {
      // PayPal price changes require buyer re-approval — redirect there.
      if (data.approvalUrl) {
        window.location.assign(data.approvalUrl);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-jobs-upcoming"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-jobs-history"] });
    }
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ addressId, days }: { addressId: string; days: PickupDayInput[] }) => {
      // A datetime-local field yields "YYYY-MM-DDTHH:mm"; the API expects a full
      // ISO-8601 timestamp, so normalize each day's anchor (only for biweekly).
      const normalized: PickupDayInput[] = days.map((day) => {
        let anchor: string | undefined;
        const raw = day.biweeklyAnchorDate?.trim();
        if (cansToCadence(day.cans) === "BIWEEKLY" && raw) {
          const parsed = new Date(raw);
          anchor = Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
        }
        return { ...day, biweeklyAnchorDate: anchor };
      });
      return updateAddressSchedule(addressId, { days: normalized }, accessToken);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-jobs-upcoming"] });
    }
  });

  const stripeCheckoutMutation = useMutation({
    mutationFn: async () =>
      createStripeCheckout(
        {
          planCode: "starter-monthly",
          successUrl: `${window.location.origin}/customer/billing?checkout=success`,
          cancelUrl: `${window.location.origin}/customer/billing?checkout=cancel`
        },
        accessToken
      ),
    onSuccess: (data) => {
      window.location.assign(data.checkoutUrl);
    }
  });

  const paypalCheckoutMutation = useMutation({
    mutationFn: async () =>
      createPayPalSubscription(
        {
          planCode: "starter-monthly",
          returnUrl: `${window.location.origin}/customer/billing?checkout=success`,
          cancelUrl: `${window.location.origin}/customer/billing?checkout=cancel`
        },
        accessToken
      ),
    onSuccess: (data) => {
      window.location.assign(data.approvalUrl);
    }
  });

  const stripePortalMutation = useMutation({
    mutationFn: async () =>
      createStripePortal(
        {
          returnUrl: `${window.location.origin}/customer/billing`
        },
        accessToken
      ),
    onSuccess: (data) => {
      // PayPal sends customers off to paypal.com to manage payments — open it in a
      // new tab so they keep the dashboard. Stripe's portal returns here, so
      // navigating in place is fine.
      if (billingSummaryQuery.data?.source === "PAYPAL") {
        window.open(data.portalUrl, "_blank", "noopener,noreferrer");
      } else {
        window.location.assign(data.portalUrl);
      }
    }
  });

  // Address/schedule config is available before paying; only the job feeds are
  // entitlement-gated, so a 402 there is our "no active subscription" signal.
  const entitlementBlocked = useMemo(() => {
    const errors = [upcomingJobsQuery.error, historyJobsQuery.error];
    return errors.some((error) => error instanceof ApiError && error.status === 402);
  }, [historyJobsQuery.error, upcomingJobsQuery.error]);

  const firstName = user.name.split(" ")[0];

  const addresses = addressesQuery.data?.addresses ?? [];
  const hasAddress = addresses.length > 0;
  // A successful job feed means the entitlement gate let us through.
  const subscriptionActive = upcomingJobsQuery.isSuccess;

  // The location-detail route lives under /customer/addresses/:id — the render
  // functions run in this parent's scope (not the nested Route's), so read the id
  // straight off the path rather than via useParams.
  const detailMatch = location.pathname.match(/\/customer\/addresses\/([^/]+)$/);
  const detailAddressId = detailMatch?.[1] ? decodeURIComponent(detailMatch[1]) : null;

  // When Stripe/PayPal redirect back after checkout, the activation webhook is
  // async — poll-refetch the session + queries so the UI reflects it without a
  // manual reload, then strip the marker from the URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkout = params.get("checkout");
    const paypalSubscriptionId = params.get("subscription_id");
    if (!checkout) {
      return;
    }
    if (checkout !== "success") {
      navigate("/customer/billing", { replace: true });
      return;
    }

    let cancelled = false;
    setFinalizingCheckout(true);
    void (async () => {
      // PayPal returns a subscription_id — confirm it directly rather than waiting
      // on the (often slow) webhook, so activation shows immediately.
      if (paypalSubscriptionId) {
        try {
          await confirmPayPalSubscription(paypalSubscriptionId, accessToken);
        } catch {
          // Fall back to the poll below if confirmation fails transiently.
        }
      }
      for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
        await refreshUser();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["customer-jobs-upcoming"] }),
          queryClient.invalidateQueries({ queryKey: ["customer-jobs-history"] }),
          queryClient.invalidateQueries({ queryKey: ["customer-addresses"] }),
          queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] })
        ]);
        // Entitlement is active once the job feed returns successfully.
        if (queryClient.getQueryState(["customer-jobs-upcoming"])?.status === "success") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!cancelled) {
        setFinalizingCheckout(false);
        navigate("/customer/billing", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // A single account-status notification, shown at the top of every customer
  // page so the message is identical everywhere. Returns null while loading.
  function renderAccountBanner(): JSX.Element | null {
    if (addressesQuery.isLoading || upcomingJobsQuery.isLoading || billingSummaryQuery.isLoading) {
      return null;
    }

    const banner = (
      tone: "ok" | "warn",
      icon: string,
      title: string,
      sub: string,
      cta: { to: string; label: string } | null
    ): JSX.Element => (
      <div className={`update-banner is-${tone}`} role="status">
        <span className="update-banner-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="update-banner-text">
          <strong>{title}</strong>
          <span>{sub}</span>
        </div>
        {cta ? (
          <Link to={cta.to} className="update-banner-cta">
            {cta.label}
          </Link>
        ) : null}
      </div>
    );

    if (addressesQuery.isError && !entitlementBlocked) {
      return banner("warn", "⚠️", "We couldn't load your account status.", getErrorMessage(addressesQuery.error), null);
    }

    const summary = billingSummaryQuery.data;

    if (!hasAddress) {
      return banner(
        "warn",
        "📍",
        "Add a service location to get started.",
        "We can't schedule pickups until you add one.",
        { to: "/customer/addresses", label: "Add location" }
      );
    }
    if (!subscriptionActive) {
      return banner(
        "warn",
        "💳",
        "Set up billing to activate your plan.",
        "An unpaid or expired plan pauses service.",
        { to: "/customer/billing", label: "Set up billing" }
      );
    }
    if (summary?.needsUpdate) {
      return banner(
        "warn",
        "⚠️",
        "Your subscription needs updating.",
        `Update to ${formatUsd(summary.totalMonthlyCents)}/mo to service all your locations.`,
        { to: "/customer/billing", label: "Review billing" }
      );
    }
    // No issue: the reassuring "all set" banner only belongs on the dashboard —
    // other pages stay clean unless there's something to act on.
    const isDashboard = location.pathname === "/customer" || location.pathname === "/customer/";
    if (!isDashboard) {
      return null;
    }
    return banner(
      "ok",
      "✅",
      "You're all set — your account is active and ready for service.",
      `${addresses.length} location${addresses.length === 1 ? "" : "s"} on an active plan.`,
      null
    );
  }

  function renderOverview(): JSX.Element {
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Welcome back, {firstName}!</h2>
          <p className="subtext">
            Signed in as {user.name} ({user.email})
          </p>
        </div>
        <div className="dash-nav-grid">
          {CUSTOMER_NAV.filter((item) => item.to !== "/customer").map((item) => (
            <Link key={item.to} to={item.to} className="dash-nav-card">
              <span className="dash-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <strong>{item.label}</strong>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  function renderSubscriptionCard(summary: NonNullable<typeof billingSummaryQuery.data>): JSX.Element {
    const tone = summary.pastDue || !summary.active ? "warn" : "ok";
    const icon = summary.pastDue ? "⚠️" : summary.active ? "✅" : "🕓";
    const headline = summary.pastDue
      ? "Payment past due"
      : summary.active
        ? `Subscription active — ${formatUsd(summary.billedMonthlyCents)}/mo`
        : "No active subscription";
    const meta = summary.pastDue
      ? "Update your payment method to keep your pickups running."
      : summary.active
        ? `Billed via ${summary.source ?? "card"}${
            summary.currentPeriodEnd
              ? ` · renews ${new Date(summary.currentPeriodEnd).toLocaleDateString()}`
              : ""
          }.`
        : hasAddress
          ? "Choose a payment method below to start service."
          : "Add a location first, then choose a payment method.";

    return (
      <article className={`panel subscription-panel is-${tone}`}>
        <div className="subscription-head">
          <span className="subscription-badge" aria-hidden="true">
            {icon}
          </span>
          <div className="subscription-head-text">
            <strong>{headline}</strong>
            <p className="subtext">{meta}</p>
          </div>
        </div>

        {summary.active && summary.needsUpdate ? (
          <div className="subscription-callout">
            <strong>
              {summary.uncoveredCount > 0
                ? `${summary.uncoveredCount} location${summary.uncoveredCount === 1 ? "" : "s"} not on your plan`
                : "Plan needs updating"}
            </strong>
            <span>
              Your plan bills {formatUsd(summary.billedMonthlyCents)}/mo. Update to{" "}
              {formatUsd(summary.totalMonthlyCents)}/mo to service{" "}
              {summary.uncoveredCount === 1 ? "it" : "all your locations"} (prorated).
            </span>
          </div>
        ) : null}

        <div className="manage-actions">
          {summary.active ? (
            <>
              {summary.needsUpdate ? (
                <button
                  type="button"
                  className="cta-primary"
                  onClick={() => updateSubscriptionMutation.mutate()}
                  disabled={updateSubscriptionMutation.isPending}
                >
                  {updateSubscriptionMutation.isPending ? "Updating…" : "Update subscription"}
                </button>
              ) : null}
              <button
                type="button"
                className={summary.needsUpdate ? "cta-secondary" : "cta-primary"}
                onClick={() => stripePortalMutation.mutate()}
                disabled={stripePortalMutation.isPending}
              >
                {stripePortalMutation.isPending
                  ? "Opening…"
                  : summary.source === "PAYPAL"
                    ? "Manage on PayPal"
                    : "Open Billing Portal"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="cta-primary"
                onClick={() => stripeCheckoutMutation.mutate()}
                disabled={stripeCheckoutMutation.isPending || !hasAddress}
              >
                {stripeCheckoutMutation.isPending ? "Redirecting…" : "Pay with Stripe"}
              </button>
              <button
                type="button"
                className="cta-secondary"
                onClick={() => paypalCheckoutMutation.mutate()}
                disabled={paypalCheckoutMutation.isPending || !hasAddress}
              >
                {paypalCheckoutMutation.isPending ? "Redirecting…" : "Pay with PayPal"}
              </button>
            </>
          )}
        </div>

        {updateSubscriptionMutation.isSuccess ? (
          <p className="success-inline">
            Subscription updated to {formatUsd(updateSubscriptionMutation.data.amountCents)}/mo.
          </p>
        ) : null}
        {updateSubscriptionMutation.isError ? (
          <p className="error">{getErrorMessage(updateSubscriptionMutation.error)}</p>
        ) : null}
        {stripePortalMutation.isError ? (
          <p className="error">{getErrorMessage(stripePortalMutation.error)}</p>
        ) : null}
      </article>
    );
  }

  function renderBilling(): JSX.Element {
    const summary = billingSummaryQuery.data;

    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Billing</h2>
          <p className="subtext">
            Your plan is billed monthly based on the locations, cans, and pickup days you set up.
          </p>
        </div>

        {finalizingCheckout ? (
          <p className="notice">Finalizing your subscription — confirming payment…</p>
        ) : null}

        {billingSummaryQuery.isLoading ? (
          <article className="panel subscription-panel">
            <div className="subscription-head">
              <span className="subscription-badge" aria-hidden="true">⏳</span>
              <div className="subscription-head-text">
                <strong>Loading billing status…</strong>
              </div>
            </div>
          </article>
        ) : summary ? (
          renderSubscriptionCard(summary)
        ) : null}

        <article className="panel">
          <h3>Addresses &amp; coverage</h3>
          {!summary || summary.addresses.length === 0 ? (
            <p className="subtext">
              Add a service address to see your price. <Link to="/customer/addresses">Add an address</Link>.
            </p>
          ) : (
            <>
              <ul className="price-breakdown">
                {summary.addresses.map((address) => (
                  <li key={address.id}>
                    <span className="price-breakdown-name">
                      {address.line1}, {address.city}
                    </span>
                    <span className="price-breakdown-meta">
                      {address.pickupsPerWeek} pickup{address.pickupsPerWeek === 1 ? "" : "s"}/week ·{" "}
                      <span className={`coverage-badge ${address.covered ? "covered" : "uncovered"}`}>
                        {address.covered ? "On plan" : "Not on plan"}
                      </span>
                    </span>
                    <span className="price-breakdown-amount">{formatUsd(address.monthlyCents)}/mo</span>
                  </li>
                ))}
              </ul>
              <div className="price-total">
                <span>{summary.active ? "Billed now" : "Estimated total"}</span>
                <strong>{formatUsd(summary.active ? summary.billedMonthlyCents : summary.totalMonthlyCents)}/mo</strong>
              </div>
              {summary.active && summary.needsUpdate ? (
                <div className="price-total secondary">
                  <span>After update</span>
                  <strong>{formatUsd(summary.totalMonthlyCents)}/mo</strong>
                </div>
              ) : null}
            </>
          )}
          <p className="subtext">
            Each can we service is {formatUsd(PRICING.perCanMonthlyCents)}/mo (a biweekly can is
            half that). Skipping roll-in on a day credits{" "}
            {formatUsd(PRICING.rollInCreditMonthlyCentsPerCan)}/mo per can; pet waste removal adds{" "}
            {formatUsd(PRICING.petWasteBaseMonthlyCents)}/mo for the first dog.
          </p>
        </article>
      </div>
    );
  }


  function renderAddresses(): JSX.Element {
    const formOpen = !hasAddress || showAddressForm;
    const summary = billingSummaryQuery.data;
    const coverageById = new Map((summary?.addresses ?? []).map((a) => [a.id, a.covered] as const));
    const uncoveredCount = summary ? addresses.filter((a) => !coverageById.get(a.id)).length : 0;

    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>My Locations</h2>
          <p className="subtext">Add a pickup location and review your saved locations.</p>
        </div>

        <div>
          {formOpen ? (
            <AddLocationWizard
              accessToken={accessToken}
              onCancel={hasAddress ? closeAddressForm : undefined}
              onDone={(createdId) => {
                setShowAddressForm(false);
                navigate(`/customer/addresses/${createdId}`);
              }}
            />
          ) : null}

          {!formOpen ? (
          <article className="panel">
            <div className="panel-head-row">
              <h3>Your Locations</h3>
              <button type="button" className="add-address-btn" onClick={() => setShowAddressForm(true)}>
                + Add Location
              </button>
            </div>
            <p className="subtext">Select a location to set its pickup schedule, cans, and pickup days.</p>
            {summary && uncoveredCount > 0 ? (
              <p className="notice">
                {uncoveredCount === 1 ? "1 location isn't" : `${uncoveredCount} locations aren't`} being
                serviced yet because {uncoveredCount === 1 ? "it isn't" : "they aren't"} included in
                your billing.{" "}
                <Link to="/customer/billing">
                  {summary.active ? "Update your subscription" : "Set up billing"}
                </Link>{" "}
                to start service.
              </p>
            ) : null}
            <ul className="address-list">
              {addresses.map((address) => (
                <AddressRow
                  key={address.id}
                  address={address}
                  covered={summary ? (coverageById.get(address.id) ?? false) : undefined}
                  onOpen={(id) => navigate(`/customer/addresses/${id}`)}
                />
              ))}
            </ul>
            {addressesQuery.isError ? <p className="error">{getErrorMessage(addressesQuery.error)}</p> : null}
          </article>
          ) : null}
        </div>
      </div>
    );
  }

  function renderLocationDetail(): JSX.Element {
    const summary = billingSummaryQuery.data;
    const coverageById = new Map((summary?.addresses ?? []).map((a) => [a.id, a.covered] as const));
    const address = addresses.find((a) => a.id === detailAddressId);

    if (addressesQuery.isLoading) {
      return (
        <div className="dash-page">
          <article className="panel">
            <p className="subtext">Loading location…</p>
          </article>
        </div>
      );
    }

    if (!address) {
      return (
        <div className="dash-page">
          <div className="dash-page-head">
            <Link to="/customer/addresses" className="back-link">
              ← Back to locations
            </Link>
            <h2>Location not found</h2>
            <p className="subtext">This location may have been removed.</p>
          </div>
        </div>
      );
    }

    const covered = summary ? (coverageById.get(address.id) ?? false) : undefined;

    return (
      <LocationDetail
        key={address.id}
        address={address}
        accessToken={accessToken}
        covered={covered}
        onRemove={(id) => {
          if (window.confirm("Remove this location? This also cancels its scheduled pickups.")) {
            deleteAddressMutation.mutate(id);
            navigate("/customer/addresses");
          }
        }}
        removing={deleteAddressMutation.isPending && deleteAddressMutation.variables === address.id}
        onSaveSchedule={(id, days) => scheduleMutation.mutate({ addressId: id, days })}
        savingSchedule={scheduleMutation.isPending}
        scheduleError={scheduleMutation.isError ? getErrorMessage(scheduleMutation.error) : null}
        scheduleSaved={scheduleMutation.isSuccess}
      />
    );
  }

  function renderJobs(): JSX.Element {
    const cadenceLabel = (c: "WEEKLY" | "BIWEEKLY") => (c === "BIWEEKLY" ? "every 2 weeks" : "weekly");
    const upcoming = upcomingJobsQuery.data?.jobs ?? [];
    const hasSchedule = addresses.some((a) => a.schedules.length > 0);

    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>My Routes</h2>
          <p className="subtext">Your recurring schedule and the next pickups we have planned.</p>
        </div>

        {/* Reassurance: what we handle, always — regardless of job generation. */}
        <article className="panel jobs-explainer">
          <div className="jobs-explainer-icon" aria-hidden="true">
            ♻️
          </div>
          <div>
            <strong>We handle it all automatically.</strong>
            <p className="subtext">
              For every pickup day, we roll your carts <b>out</b> the evening before and roll them{" "}
              <b>in</b> the day after — no reminders needed. New dates appear here on their own; there's
              nothing for you to run.
            </p>
          </div>
        </article>

        <article className="panel">
          <h3>Your pickup schedule</h3>
          {!hasSchedule ? (
            <p className="subtext">
              No pickup schedule yet. Add a location to set your pickup days.
            </p>
          ) : (
            <ul className="jobs-schedule-list">
              {addresses.map((a) =>
                [...a.schedules]
                  .sort((x, y) => x.dayOfWeek - y.dayOfWeek)
                  .map((s) => (
                    <li className="jobs-schedule-row" key={s.id}>
                      <span className="jobs-schedule-day">{WEEKDAYS[s.dayOfWeek]}s</span>
                      <span className="admin-table-sub">
                        {a.line1} · {s.canCount} can{s.canCount === 1 ? "" : "s"} ·{" "}
                        {cadenceLabel(s.cadence)} ·{" "}
                        {s.rollIn ? "roll-out & roll-in" : "roll-out only"}
                      </span>
                    </li>
                  ))
              )}
            </ul>
          )}
        </article>

        <article className="panel">
          <h3>Next scheduled pickups</h3>
          {!hasActivePlan ? (
            <p className="subtext">
              Once your plan is active, your upcoming roll-out and roll-in dates will appear here.
            </p>
          ) : upcomingJobsQuery.isLoading ? (
            <p className="subtext">Loading…</p>
          ) : upcoming.length === 0 ? (
            <p className="subtext">
              You're all set — specific dates will appear here as they're scheduled.
            </p>
          ) : (
            <ul className="jobs-upcoming-list">
              {upcoming.slice(0, 20).map((job) => {
                const skipped = job.status === "SKIPPED";
                const shifted = !skipped && Boolean(job.shiftReason);
                const fmt = (iso: string) =>
                  new Date(iso).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric"
                  });
                return (
                  <li className={`jobs-upcoming-row${skipped ? " is-skipped" : ""}`} key={job.id}>
                    <span
                      className={`jobs-job-tag ${
                        skipped ? "is-skip" : job.type === "CURB_OUT" ? "is-out" : "is-in"
                      }`}
                    >
                      {skipped ? "No pickup" : job.type === "CURB_OUT" ? "Roll-out" : "Roll-in"}
                    </span>
                    <span className="jobs-job-date">{fmt(job.scheduledDate)}</span>
                    <span className="admin-table-sub">
                      {skipped
                        ? "Trash provider holiday — no collection this week"
                        : shifted
                          ? `Holiday-adjusted${
                              job.shiftedFromDate ? ` — normally ${fmt(job.shiftedFromDate)}` : ""
                            }`
                          : job.type === "CURB_OUT"
                            ? "Carts to the curb"
                            : "Carts back from the curb"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {upcomingJobsQuery.isError ? (
            <p className="error">{getErrorMessage(upcomingJobsQuery.error)}</p>
          ) : null}
        </article>
      </div>
    );
  }

  function renderHistory(): JSX.Element {
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Recent History</h2>
          <p className="subtext">A look back at your recent pickups.</p>
        </div>
        <article className="panel">
          <ul className="meta-list compact">
            {historyJobsQuery.data?.jobs.slice(0, 8).map((job) => (
              <li key={job.id}>
                {new Date(job.scheduledDate).toLocaleDateString()} - {job.type} ({job.status})
              </li>
            ))}
          </ul>
          {historyJobsQuery.data && historyJobsQuery.data.jobs.length === 0 ? (
            <p className="subtext">No past jobs yet.</p>
          ) : null}
          {historyJobsQuery.isError ? <p className="error">{getErrorMessage(historyJobsQuery.error)}</p> : null}
        </article>
      </div>
    );
  }

  return (
    <section className="card role-shell customer-workspace">
      {renderAccountBanner()}
      <Routes>
        <Route index element={renderOverview()} />
        <Route path="billing" element={renderBilling()} />
        <Route path="addresses" element={renderAddresses()} />
        <Route path="addresses/:addressId" element={renderLocationDetail()} />
        <Route path="jobs" element={renderJobs()} />
        <Route path="history" element={renderHistory()} />
        <Route path="*" element={<Navigate to="/customer" replace />} />
      </Routes>
    </section>
  );
}

// The service-status badge for a location: covered but not yet admin-approved
// shows "Pending approval" so the customer knows why a paid location isn't live.
function coverageBadge(
  covered: boolean | undefined,
  approved: boolean
): { cls: string; text: string } | null {
  if (covered === undefined) return null;
  if (!covered) return { cls: "uncovered", text: "Not serviced" };
  if (!approved) return { cls: "pending", text: "⏳ Pending approval" };
  return { cls: "covered", text: "✓ Serviced" };
}

function scheduleSummary(address: ServiceAddress): string {
  const days = address.schedules ?? [];
  if (days.length === 0) {
    return "No pickup schedule set";
  }
  const labels = [...days]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((d) => (WEEKDAYS[d.dayOfWeek] ?? "—").slice(0, 3))
    .join(", ");
  const anyBiweekly = days.some((d) => d.cadence === "BIWEEKLY");
  return `Pickup ${labels}${anyBiweekly ? " · some biweekly" : ""}`;
}

function AddressRow({
  address,
  covered,
  onOpen
}: {
  address: ServiceAddress;
  covered: boolean | undefined;
  onOpen: (id: string) => void;
}): JSX.Element {
  const monthly = addressMonthlyCents((address.schedules ?? []).map(toPricingDay));
  const coverageClass = covered === undefined ? "" : covered ? " is-covered" : " is-uncovered";

  return (
    <li
      className={`address-row is-clickable${coverageClass}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(address.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(address.id);
        }
      }}
    >
      <div className="address-row-lead">
        <span className="address-row-icon" aria-hidden="true">
          🏠
        </span>
        <div className="address-row-main">
          <strong>{address.line1}</strong>
          <span className="subtext">
            {address.city}, {address.state} {address.postalCode}
          </span>
          {(() => {
            const b = coverageBadge(covered, address.serviceApproved);
            return b ? <span className={`coverage-badge ${b.cls}`}>{b.text}</span> : null;
          })()}
        </div>
      </div>
      <div className="address-row-meta">
        <span className="address-row-summary">
          {(address.schedules ?? []).length} pickup
          {(address.schedules ?? []).length === 1 ? "" : "s"}/week
          <span className="address-row-schedule">{scheduleSummary(address)}</span>
        </span>
        <span className="address-row-price">
          {formatUsd(monthly)}
          <span>/mo</span>
        </span>
        <span className="address-row-chevron" aria-hidden="true">
          ›
        </span>
      </div>
    </li>
  );
}

type EditDay = {
  dayOfWeek: number;
  cans: ScheduleCan[];
  rollIn: boolean;
  petWasteDogs: number;
  providerSynced: boolean;
  biweeklyAnchorDate: string;
};

const DEFAULT_CANS: ScheduleCan[] = [{ type: "TRASH", cadence: "WEEKLY", count: 1 }];

function LocationDetail({
  address,
  accessToken,
  covered,
  onRemove,
  removing,
  onSaveSchedule,
  savingSchedule,
  scheduleError,
  scheduleSaved
}: {
  address: ServiceAddress;
  accessToken: string;
  covered: boolean | undefined;
  onRemove: (id: string) => void;
  removing: boolean;
  onSaveSchedule: (id: string, days: PickupDayInput[]) => void;
  savingSchedule: boolean;
  scheduleError: string | null;
  scheduleSaved: boolean;
}): JSX.Element {
  const queryClient = useQueryClient();
  const initialDays: EditDay[] =
    address.schedules.length > 0
      ? [...address.schedules]
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
          .map((s) => ({
            dayOfWeek: s.dayOfWeek,
            cans: s.cans.length > 0 ? s.cans : DEFAULT_CANS,
            rollIn: s.rollIn,
            petWasteDogs: s.petWasteDogs,
            providerSynced: s.providerSynced,
            biweeklyAnchorDate: s.biweeklyAnchorDate?.slice(0, 16) ?? ""
          }))
      : [
          {
            dayOfWeek: DEFAULT_PICKUP_DAYS[0]!,
            cans: DEFAULT_CANS,
            rollIn: true,
            petWasteDogs: 0,
            providerSynced: false,
            biweeklyAnchorDate: ""
          }
        ];
  const [days, setDays] = useState<EditDay[]>(initialDays);
  const [submitted, setSubmitted] = useState(false);

  // Trash-provider sync: on open, attempt to match the address to a provider and,
  // if the schedule isn't already aligned, prompt the customer to verify pickups.
  const [providerResult, setProviderResult] = useState<PickupScheduleSuggestion | null>(null);
  const [reviewingProvider, setReviewingProvider] = useState(false);

  const providerConnect = useMutation({
    mutationFn: (_opts: { force?: boolean } = {}) => connectProvider(address.id, accessToken),
    onSuccess: (result, opts) => {
      setProviderResult(result);
      if (!result.matched) {
        return;
      }
      if (opts?.force) {
        // Explicit re-check or an address change — always open the review.
        setReviewingProvider(true);
        return;
      }
      // Auto (on open): only prompt when there's something to do — a provider day
      // missing from the schedule, or an existing pickup on a provider day that
      // isn't synced.
      const providerWeekdays = new Set(result.streams.map((s) => s.dayOfWeek));
      const scheduleWeekdays = new Set(address.schedules.map((s) => s.dayOfWeek));
      const missingDay = [...providerWeekdays].some((w) => !scheduleWeekdays.has(w));
      const unsynced = address.schedules.some(
        (s) => providerWeekdays.has(s.dayOfWeek) && !s.providerSynced
      );
      if (missingDay || unsynced) {
        setReviewingProvider(true);
      }
    }
  });

  const providerApply = useMutation({
    mutationFn: (payload: PickupDayInput[]) => updateAddressSchedule(address.id, { days: payload }, accessToken),
    onSuccess: async (_data, payload) => {
      // Reflect the synced schedule in the editor immediately.
      setDays(
        payload.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          cans: d.cans.length > 0 ? d.cans : DEFAULT_CANS,
          rollIn: d.rollIn ?? true,
          petWasteDogs: d.petWasteDogs ?? 0,
          providerSynced: d.providerSynced ?? false,
          biweeklyAnchorDate: d.biweeklyAnchorDate?.slice(0, 16) ?? ""
        }))
      );
      await queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      await queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
      setReviewingProvider(false);
      setProviderResult(null);
    }
  });

  // Attempt the provider sync once when the location opens.
  useEffect(() => {
    providerConnect.mutate({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.id]);

  // Whether this address falls in a serviced area (re-checked when it changes).
  const [areaEligible, setAreaEligible] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    checkServiceArea(address.postalCode, { includeTest: true })
      .then((r) => {
        if (active) setAreaEligible(r.eligible);
      })
      .catch(() => {
        if (active) setAreaEligible(null);
      });
    return () => {
      active = false;
    };
  }, [address.postalCode]);

  // Persistent warnings: address not in a serviced area, and/or no trash provider.
  const addressNotFound = areaEligible === false;
  const providerNotFound = Boolean(providerResult) && !providerResult?.matched;

  // ---- Edit address ----
  const [editingAddress, setEditingAddress] = useState(false);
  const [addr, setAddr] = useState({
    line1: address.line1,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode
  });
  const addressMutation = useMutation({
    mutationFn: () =>
      updateAddress(
        address.id,
        {
          line1: addr.line1.trim(),
          city: addr.city.trim(),
          state: addr.state.trim(),
          postalCode: addr.postalCode.trim()
        },
        accessToken
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      await queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
      setEditingAddress(false);
      // The address changed — re-detect the trash provider and prompt to re-sync.
      providerConnect.mutate({ force: true });
    }
  });
  const openEditAddress = (): void => {
    setAddr({
      line1: address.line1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode
    });
    setEditingAddress(true);
  };

  const usedDays = new Set(days.map((d) => d.dayOfWeek));
  const firstAvailableDay = [0, 1, 2, 3, 4, 5, 6].find((d) => !usedDays.has(d));

  const valid =
    days.length >= 1 &&
    days.every(
      (d) =>
        d.cans.length >= 1 &&
        d.cans.every((c) => c.count >= 1 && c.count <= 20) &&
        (cansToCadence(d.cans) !== "BIWEEKLY" || d.biweeklyAnchorDate.length > 0)
    );
  const monthly = addressMonthlyCents(
    days.map((d) => ({ cans: d.cans, rollIn: d.rollIn, petWasteDogs: d.petWasteDogs }))
  );

  // Enable Save only when the current config differs from what's saved.
  const canonical = (list: EditDay[]): string =>
    [...list]
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map(
        (d) =>
          `${d.dayOfWeek}|${JSON.stringify(d.cans)}|${d.rollIn}|${d.petWasteDogs}|${d.providerSynced}|${
            cansToCadence(d.cans) === "BIWEEKLY" ? d.biweeklyAnchorDate : ""
          }`
      )
      .join(";");
  const dirty = canonical(days) !== canonical(initialDays);

  function updateDay(idx: number, patch: Partial<EditDay>): void {
    // Manually changing the weekday or cans opts the day out of provider sync.
    const optsOut = patch.dayOfWeek !== undefined || patch.cans !== undefined;
    const effective = optsOut ? { ...patch, providerSynced: false } : patch;
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...effective } : d)));
  }
  function removeDay(idx: number): void {
    setDays((prev) => prev.filter((_, i) => i !== idx));
  }
  function addDay(): void {
    if (firstAvailableDay === undefined) {
      return;
    }
    setDays((prev) => [
      ...prev,
      {
        dayOfWeek: firstAvailableDay,
        cans: DEFAULT_CANS,
        rollIn: true,
        petWasteDogs: 0,
        providerSynced: false,
        biweeklyAnchorDate: ""
      }
    ]);
  }

  function handleSaveAll(event: FormEvent): void {
    event.preventDefault();
    if (!valid) {
      return;
    }
    setSubmitted(true);
    onSaveSchedule(
      address.id,
      days.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        biweeklyAnchorDate:
          cansToCadence(d.cans) === "BIWEEKLY" ? d.biweeklyAnchorDate || undefined : undefined,
        cans: d.cans,
        rollIn: d.rollIn,
        petWasteDogs: d.petWasteDogs,
        providerSynced: d.providerSynced
      }))
    );
  }

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <Link to="/customer/addresses" className="back-link">
          ← Back to locations
        </Link>
        <h2>{address.line1}</h2>
        <p className="subtext">
          {address.city}, {address.state} {address.postalCode}
          {(() => {
            const b = coverageBadge(covered, address.serviceApproved);
            return b ? <span className={`coverage-badge ${b.cls}`}>{b.text}</span> : null;
          })()}
          {!editingAddress ? (
            <>
              {" · "}
              <button type="button" className="link-button" onClick={openEditAddress}>
                Edit address
              </button>
            </>
          ) : null}
        </p>
        {addressNotFound || providerNotFound ? (
          <p className="notice">
            ⚠️{" "}
            {addressNotFound && providerNotFound
              ? "We couldn't confirm this address is in an area we service, and no trash provider was found for it."
              : addressNotFound
                ? "We couldn't confirm this address is in an area we service yet."
                : "No trash provider was found for this address, so pickups won't auto-follow a provider or its holiday shifts."}{" "}
            You can keep this location and set the schedule manually — use <strong>Edit address</strong> if
            you need to correct it, or contact us if you think this is a mistake.
          </p>
        ) : null}
      </div>

      {editingAddress ? (
        <article className="panel">
          <div className="panel-head-row">
            <h3>Edit address</h3>
            <button type="button" className="link-inline" onClick={() => setEditingAddress(false)}>
              Cancel
            </button>
          </div>
          <p className="subtext">Saving re-checks the trash provider and offers to re-sync your days.</p>
          <label>
            Line 1
            <input value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
          </label>
          <div className="field-row">
            <label>
              City
              <input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
            </label>
            <label>
              State
              <input value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} />
            </label>
          </div>
          <label className="field-single">
            Postal code
            <input
              value={addr.postalCode}
              onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })}
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              className="cta-primary"
              disabled={addressMutation.isPending}
              onClick={() => addressMutation.mutate()}
            >
              {addressMutation.isPending ? "Saving…" : "Update address"}
            </button>
          </div>
          {addressMutation.isError ? (
            <p className="error">{getErrorMessage(addressMutation.error)}</p>
          ) : null}
        </article>
      ) : null}

      <form onSubmit={handleSaveAll}>
        <article className="panel">
          <div className="panel-head-row">
            <div className="panel-head-text">
              <h3>Pickup schedule</h3>
              <span className="detail-total">{formatUsd(monthly)}/mo</span>
            </div>
            <button
              type="button"
              className="add-day-btn"
              onClick={addDay}
              disabled={firstAvailableDay === undefined}
            >
              + Add day
            </button>
          </div>
          <p className="subtext">
            Each pickup day has its own cans, cadence, and roll-in. {days.length} pickup
            {days.length === 1 ? "" : "s"}/week.
          </p>

          {reviewingProvider && providerResult?.matched ? (
            <ProviderSyncReview
              providerLabel={providerResult.providerLabel}
              streams={providerResult.streams}
              pickups={address.schedules.map((s) => ({
                dayOfWeek: s.dayOfWeek,
                cans: s.cans.length > 0 ? s.cans : DEFAULT_CANS,
                rollIn: s.rollIn,
                petWasteDogs: s.petWasteDogs,
                biweeklyAnchorDate: s.biweeklyAnchorDate
              }))}
              saving={providerApply.isPending}
              error={providerApply.isError ? getErrorMessage(providerApply.error) : null}
              onApply={(payload) => providerApply.mutate(payload)}
              onSkip={() => setReviewingProvider(false)}
            />
          ) : (
            <p className="subtext provider-status-line">
              {providerConnect.isPending ? (
                "Checking your trash provider…"
              ) : providerResult?.matched ? (
                <>
                  ♻️ Trash provider: <strong>{providerResult.providerLabel}</strong>.{" "}
                </>
              ) : (
                <>No trash provider connected for this address. </>
              )}
              {!providerConnect.isPending ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => providerConnect.mutate({ force: true })}
                >
                  {providerResult?.matched ? "Review & sync pickups" : "Check for a trash provider"}
                </button>
              ) : null}
            </p>
          )}

          <ul className="pickup-day-list">
            {days.map((day, idx) => {
              const dayCost = pickupDayMonthlyCents({
                cans: day.cans,
                rollIn: day.rollIn,
                petWasteDogs: day.petWasteDogs
              });
              const dayIsBiweekly = cansToCadence(day.cans) === "BIWEEKLY";
              return (
                <li className="pickup-day-card" key={idx}>
                  <div className="pickup-day-top">
                    <span className="pickup-day-icon" aria-hidden="true">
                      🗓️
                    </span>
                    <label className="pickup-day-weekday-field">
                      <span className="pickup-day-eyebrow">Pickup day</span>
                      <select
                        className="pickup-day-weekday"
                        value={day.dayOfWeek}
                        onChange={(event) => updateDay(idx, { dayOfWeek: Number(event.target.value) })}
                      >
                        {WEEKDAYS.map((label, value) => (
                          <option
                            key={label}
                            value={value}
                            disabled={value !== day.dayOfWeek && usedDays.has(value)}
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="pickup-day-cost">{formatUsd(dayCost)}/mo</span>
                    {!day.providerSynced ? (
                      <span className="loc-chip is-none">Not synced</span>
                    ) : null}
                    <button
                      type="button"
                      className="pickup-day-remove"
                      onClick={() => removeDay(idx)}
                      disabled={days.length <= 1}
                      aria-label={`Remove ${WEEKDAYS[day.dayOfWeek]}`}
                    >
                      ×
                    </button>
                  </div>

                  <div className="pickup-day-body">
                    <div className="can-rows-field">
                      <span className="pickup-day-eyebrow">Cans collected this day</span>
                      <CanRowsEditor
                        cans={day.cans}
                        onChange={(cans) => updateDay(idx, { cans })}
                      />
                    </div>

                    {dayIsBiweekly ? (
                      <label className="field-single">
                        First pickup date
                        <input
                          type="datetime-local"
                          value={day.biweeklyAnchorDate}
                          onChange={(event) => updateDay(idx, { biweeklyAnchorDate: event.target.value })}
                        />
                      </label>
                    ) : null}

                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={day.rollIn}
                        onChange={(event) => updateDay(idx, { rollIn: event.target.checked })}
                      />
                      <span>
                        <strong>Bring cans back the next day (roll-in)</strong>
                        <span className="subtext">
                          {day.rollIn
                            ? "Included — we return the cans the day after pickup."
                            : `We'll only roll out — saves ${formatUsd(
                                cansToCanCount(day.cans) * PRICING.rollInCreditMonthlyCentsPerCan
                              )}/mo on this day.`}
                        </span>
                      </span>
                    </label>

                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={day.petWasteDogs > 0}
                        onChange={(event) =>
                          updateDay(idx, { petWasteDogs: event.target.checked ? 1 : 0 })
                        }
                      />
                      <span>
                        <strong>
                          Pet waste removal (+{formatUsd(PRICING.petWasteBaseMonthlyCents)}/mo)
                        </strong>
                        <span className="subtext">
                          We&apos;ll clean up your dog&apos;s waste from the yard and put it in the
                          trash bin before rolling out.
                        </span>
                      </span>
                    </label>

                    {day.petWasteDogs > 0 ? (
                      <label className="field-inline">
                        <span>Number of dogs</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={day.petWasteDogs}
                          onChange={(event) =>
                            updateDay(idx, {
                              petWasteDogs: Math.max(1, Math.min(20, Number(event.target.value) || 1))
                            })
                          }
                        />
                        <span className="subtext">
                          {formatUsd(petWasteMonthlyCents(day.petWasteDogs))}/mo
                          {day.petWasteDogs > 1
                            ? ` — ${formatUsd(PRICING.petWasteBaseMonthlyCents)} for the first dog + ${formatUsd(
                                PRICING.petWasteExtraDogMonthlyCents
                              )}/mo each additional`
                            : ""}
                        </span>
                      </label>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </article>

        <div className="detail-save-row">
          {dirty || savingSchedule ? (
            <button type="submit" className="cta-primary" disabled={!valid || savingSchedule}>
              {savingSchedule ? "Saving…" : "Update pickup schedule"}
            </button>
          ) : null}
          {submitted && !savingSchedule && !scheduleError && scheduleSaved && !dirty ? (
            <span className="success-inline">All changes saved.</span>
          ) : null}
        </div>
        {scheduleError ? <p className="error">{scheduleError}</p> : null}
      </form>

      <article className="panel">
        <h3>Remove location</h3>
        <p className="subtext">
          Removing this location cancels its scheduled pickups. This can't be undone.
        </p>
        <button
          type="button"
          className="address-row-remove"
          disabled={removing}
          onClick={() => onRemove(address.id)}
        >
          {removing ? "Removing…" : "Remove location"}
        </button>
      </article>
    </div>
  );
}
