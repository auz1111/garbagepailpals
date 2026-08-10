import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { CurrentUser, ServiceAddress, ServiceAddressInput, ServiceScheduleInput } from "@gpp/shared";
import { addressMonthlyCents, formatUsd, monthlyTotalCents, PRICING } from "@gpp/shared";
import {
  ApiError,
  checkServiceArea,
  createAddress,
  createPayPalSubscription,
  createStripeCheckout,
  createStripePortal,
  generateJobs,
  getBillingSummary,
  updateSubscription,
  listAddresses,
  listHistoryJobs,
  listUpcomingJobs,
  updateAddress,
  upsertAddressSchedule
} from "../lib/api";

type CustomerWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
  refreshUser: () => Promise<void>;
};

type ServiceAreaForm = {
  postalCode: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

const defaultAddressValues: ServiceAddressInput = {
  line1: "",
  city: "",
  state: "",
  postalCode: "",
  lat: 45.52,
  lng: -122.67,
  timezone: "America/Los_Angeles",
  accessNotes: "Leave can near driveway gate.",
  canCount: 2,
  pickupsPerWeek: 1,
  isActive: true
};

const defaultScheduleValues: ServiceScheduleInput = {
  pickupDayOfWeek: 2,
  cadence: "WEEKLY",
  curbOutOffsetHours: -12,
  curbInOffsetHours: 8
};

export const CUSTOMER_NAV = [
  { to: "/customer", label: "Overview", icon: "🏡", end: true },
  { to: "/customer/billing", label: "Billing", icon: "💳" },
  { to: "/customer/service-area", label: "Service Area", icon: "📍" },
  { to: "/customer/addresses", label: "Addresses", icon: "🏠" },
  { to: "/customer/schedule", label: "Schedule", icon: "🗓️" },
  { to: "/customer/jobs", label: "Upcoming Jobs", icon: "🚚" },
  { to: "/customer/history", label: "History", icon: "🕓" }
] as const;

export function CustomerWorkspace({ user, accessToken, refreshUser }: CustomerWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [finalizingCheckout, setFinalizingCheckout] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [serviceAreaResult, setServiceAreaResult] = useState<
    { postalCode: string; eligible: boolean } | null
  >(null);
  const [serviceAreaError, setServiceAreaError] = useState<string | null>(null);

  const serviceAreaForm = useForm<ServiceAreaForm>({
    defaultValues: { postalCode: "" }
  });

  const addressForm = useForm<ServiceAddressInput>({
    defaultValues: defaultAddressValues
  });

  const scheduleForm = useForm<ServiceScheduleInput>({
    defaultValues: defaultScheduleValues
  });

  const addressesQuery = useQuery({
    queryKey: ["customer-addresses"],
    queryFn: async () => listAddresses(accessToken)
  });

  const upcomingJobsQuery = useQuery({
    queryKey: ["customer-jobs-upcoming"],
    queryFn: async () => listUpcomingJobs(accessToken)
  });

  const historyJobsQuery = useQuery({
    queryKey: ["customer-jobs-history"],
    queryFn: async () => listHistoryJobs(accessToken)
  });

  const billingSummaryQuery = useQuery({
    queryKey: ["customer-billing-summary"],
    queryFn: async () => getBillingSummary(accessToken)
  });

  const createAddressMutation = useMutation({
    mutationFn: (input: ServiceAddressInput) => createAddress(input, accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
      addressForm.reset(defaultAddressValues);
    }
  });

  const updateAddressMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ServiceAddressInput> }) =>
      updateAddress(id, patch, accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
    }
  });

  const generateJobsMutation = useMutation({
    mutationFn: () => generateJobs(accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-jobs-upcoming"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-jobs-history"] });
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
    mutationFn: (input: ServiceScheduleInput) => {
      if (!selectedAddressId) {
        throw new Error("Choose an address before saving schedule");
      }

      const normalizedInput: ServiceScheduleInput = {
        ...input,
        biweeklyAnchorDate:
          input.biweeklyAnchorDate && input.biweeklyAnchorDate.trim().length > 0
            ? input.biweeklyAnchorDate
            : undefined
      };

      return upsertAddressSchedule(selectedAddressId, normalizedInput, accessToken);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
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
      window.location.assign(data.portalUrl);
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
  const monthlyTotal = monthlyTotalCents(addresses);

  // When Stripe/PayPal redirect back after checkout, the activation webhook is
  // async — poll-refetch the session + queries so the UI reflects it without a
  // manual reload, then strip the marker from the URL.
  useEffect(() => {
    const checkout = new URLSearchParams(location.search).get("checkout");
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

  function renderAccountStatus(): JSX.Element {
    if (addressesQuery.isLoading || upcomingJobsQuery.isLoading) {
      return (
        <div className="account-status is-info">
          <span className="account-status-icon" aria-hidden="true">
            ⏳
          </span>
          <div className="account-status-body">
            <strong>Checking your account status…</strong>
          </div>
        </div>
      );
    }

    // A non-entitlement error means we couldn't read the account at all.
    if (addressesQuery.isError && !entitlementBlocked) {
      return (
        <div className="account-status is-warn">
          <span className="account-status-icon" aria-hidden="true">
            ⚠️
          </span>
          <div className="account-status-body">
            <strong>We couldn't load your account status.</strong>
            <p className="subtext">{getErrorMessage(addressesQuery.error)}</p>
          </div>
        </div>
      );
    }

    const allOk = subscriptionActive && hasAddress;

    return (
      <div className={`account-status ${allOk ? "is-ok" : "is-warn"}`}>
        <span className="account-status-icon" aria-hidden="true">
          {allOk ? "✅" : "⚠️"}
        </span>
        <div className="account-status-body">
          <strong>
            {allOk
              ? "You're all set — your account is active and ready for service."
              : "Action needed before we can service your cans."}
          </strong>
          <ul className="account-status-list">
            <li className={subscriptionActive ? "ok" : "bad"}>
              {subscriptionActive ? (
                "Subscription active"
              ) : (
                <>
                  No active subscription — <Link to="/customer/billing">set up billing</Link> to
                  activate your plan (an unpaid or expired plan pauses service).
                </>
              )}
            </li>
            <li
              className={
                !subscriptionActive ? "pending" : hasAddress ? "ok" : "bad"
              }
            >
              {!subscriptionActive ? (
                "Service address — activate your subscription first"
              ) : hasAddress ? (
                `${addresses.length} service address${addresses.length === 1 ? "" : "es"} added`
              ) : (
                <>
                  No service address yet — <Link to="/customer/addresses">add one</Link> so we can
                  schedule pickups.
                </>
              )}
            </li>
          </ul>
        </div>
      </div>
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
        {renderAccountStatus()}
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

  function renderBillingStatus(summary: NonNullable<typeof billingSummaryQuery.data>): JSX.Element {
    if (summary.pastDue) {
      return (
        <div className="account-status is-warn">
          <span className="account-status-icon" aria-hidden="true">⚠️</span>
          <div className="account-status-body">
            <strong>Payment past due</strong>
            <p className="subtext">Update your payment method to keep your pickups running.</p>
          </div>
        </div>
      );
    }
    if (summary.active) {
      return (
        <div className="account-status is-ok">
          <span className="account-status-icon" aria-hidden="true">✅</span>
          <div className="account-status-body">
            <strong>Subscription active — {formatUsd(summary.coveredMonthlyCents)}/mo</strong>
            <p className="subtext">
              Billed via {summary.source ?? "card"}
              {summary.currentPeriodEnd
                ? ` · renews ${new Date(summary.currentPeriodEnd).toLocaleDateString()}`
                : ""}
              .
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="account-status is-warn">
        <span className="account-status-icon" aria-hidden="true">⚠️</span>
        <div className="account-status-body">
          <strong>No active subscription yet</strong>
          <p className="subtext">
            {summary.addresses.length > 0
              ? "Activate below to start service."
              : "Add a service address, then activate."}
          </p>
        </div>
      </div>
    );
  }

  function renderBilling(): JSX.Element {
    const summary = billingSummaryQuery.data;
    const extraCents = summary ? summary.totalMonthlyCents - summary.coveredMonthlyCents : 0;

    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Billing</h2>
          <p className="subtext">
            Your plan is billed monthly based on the addresses, cans, and pickup days you set up.
          </p>
        </div>

        {finalizingCheckout ? (
          <p className="notice">Finalizing your subscription — confirming payment…</p>
        ) : null}

        {billingSummaryQuery.isLoading ? (
          <div className="account-status is-info">
            <span className="account-status-icon" aria-hidden="true">⏳</span>
            <div className="account-status-body">
              <strong>Loading billing status…</strong>
            </div>
          </div>
        ) : summary ? (
          renderBillingStatus(summary)
        ) : null}

        {summary && summary.active && summary.uncoveredCount > 0 ? (
          <p className="notice">
            {summary.uncoveredCount} address{summary.uncoveredCount === 1 ? "" : "es"} added since you
            subscribed {summary.uncoveredCount === 1 ? "isn't" : "aren't"} on your plan yet
            (+{formatUsd(extraCents)}/mo). Update your subscription to include{" "}
            {summary.uncoveredCount === 1 ? "it" : "them"}.
          </p>
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
                      {address.canCount} cans · {address.pickupsPerWeek}×/week ·{" "}
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
            Each address includes {PRICING.includedCansPerAddress} cans and 1 pickup/week
            ({formatUsd(PRICING.baseMonthlyCentsPerAddress)}/mo). Extra cans add{" "}
            {formatUsd(PRICING.extraCanMonthlyCents)}/mo each; extra pickup days add{" "}
            {formatUsd(PRICING.extraPickupDayMonthlyCents)}/mo each.
          </p>
        </article>

        <article className="panel">
          <h3>{summary?.active ? "Manage subscription" : "Activate subscription"}</h3>
          <p className="subtext">
            {!hasAddress
              ? "Add a service address to activate."
              : summary?.active
                ? summary.needsUpdate
                  ? `Your plan bills ${formatUsd(summary.billedMonthlyCents)}/mo. Update to ${formatUsd(summary.totalMonthlyCents)}/mo to match your current addresses (prorated).`
                  : "Your plan is up to date. Manage payment details in the billing portal."
                : `You'll be billed ${formatUsd(summary?.totalMonthlyCents ?? 0)}/month via Stripe or PayPal.`}
          </p>
          <div className="button-row">
            {summary?.active ? (
              <>
                {summary.needsUpdate ? (
                  <button
                    type="button"
                    onClick={() => updateSubscriptionMutation.mutate()}
                    disabled={updateSubscriptionMutation.isPending}
                  >
                    {updateSubscriptionMutation.isPending ? "Updating…" : "Update subscription"}
                  </button>
                ) : null}
                <button type="button" onClick={() => stripePortalMutation.mutate()} disabled={stripePortalMutation.isPending}>
                  {stripePortalMutation.isPending ? "Opening..." : "Open Billing Portal"}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => stripeCheckoutMutation.mutate()} disabled={stripeCheckoutMutation.isPending || !hasAddress}>
                  {stripeCheckoutMutation.isPending ? "Redirecting..." : "Pay with Stripe"}
                </button>
                <button type="button" onClick={() => paypalCheckoutMutation.mutate()} disabled={paypalCheckoutMutation.isPending || !hasAddress}>
                  {paypalCheckoutMutation.isPending ? "Redirecting..." : "Pay with PayPal"}
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
        </article>
      </div>
    );
  }

  function renderServiceArea(): JSX.Element {
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Service Area Check</h2>
          <p className="subtext">Confirm we operate in a ZIP code.</p>
        </div>
        <article className="panel">
          <form
            onSubmit={serviceAreaForm.handleSubmit(
              async (values) => {
                setServiceAreaError(null);
                try {
                  const result = await checkServiceArea(values.postalCode.trim());
                  setServiceAreaResult(result);
                } catch (error) {
                  setServiceAreaResult(null);
                  setServiceAreaError(getErrorMessage(error));
                }
              },
              () => {
                // Validation failed (e.g. blank field) — clear any stale result.
                setServiceAreaResult(null);
                setServiceAreaError(null);
              }
            )}
          >
            <label>
              Postal code
              <input
                {...serviceAreaForm.register("postalCode", {
                  validate: (value) =>
                    value.trim().length > 0 || "Please enter a postal code to check."
                })}
                placeholder="97702"
              />
            </label>
            <button type="submit">Check Area</button>
            {serviceAreaForm.formState.errors.postalCode ? (
              <p className="error">{serviceAreaForm.formState.errors.postalCode.message}</p>
            ) : null}
            {serviceAreaError ? <p className="error">{serviceAreaError}</p> : null}
          </form>
          {serviceAreaResult ? (
            <p className={serviceAreaResult.eligible ? "success-inline" : "error"}>
              {serviceAreaResult.postalCode}: {serviceAreaResult.eligible ? "In service area" : "Out of service area"}
            </p>
          ) : null}
        </article>
      </div>
    );
  }

  function renderAddresses(): JSX.Element {
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Addresses</h2>
          <p className="subtext">Add a pickup location and review your saved addresses.</p>
        </div>
        <div className="panel-grid">
          <article className="panel">
            <h3>Add Service Address</h3>
            <form onSubmit={addressForm.handleSubmit((values) => createAddressMutation.mutate(values))}>
              <label>
                Line 1
                <input {...addressForm.register("line1")} placeholder="123 Main St" />
              </label>
              <label>
                City
                <input {...addressForm.register("city")} placeholder="Portland" />
              </label>
              <label>
                State
                <input {...addressForm.register("state")} placeholder="OR" />
              </label>
              <label>
                Postal code
                <input {...addressForm.register("postalCode")} placeholder="97702" />
              </label>
              <label>
                Timezone
                <input {...addressForm.register("timezone")} placeholder="America/Los_Angeles" />
              </label>
              <label>
                Access notes
                <input {...addressForm.register("accessNotes")} placeholder="Gate opens inward" />
              </label>
              <div className="field-row">
                <label>
                  Cans
                  <input type="number" min={1} max={20} {...addressForm.register("canCount", { valueAsNumber: true })} />
                </label>
                <label>
                  Pickups per week
                  <input
                    type="number"
                    min={1}
                    max={7}
                    {...addressForm.register("pickupsPerWeek", { valueAsNumber: true })}
                  />
                </label>
              </div>
              <p className="subtext">
                Defaults to {PRICING.includedCansPerAddress} cans, 1 pickup/week. More cans or pickup
                days increase your monthly cost.
              </p>
              <button type="submit" disabled={createAddressMutation.isPending}>
                {createAddressMutation.isPending ? "Saving..." : "Save Address"}
              </button>
            </form>
            {createAddressMutation.isError ? <p className="error">{getErrorMessage(createAddressMutation.error)}</p> : null}
          </article>

          <article className="panel">
            <h3>Your Addresses</h3>
            <p className="subtext">Adjust cans and pickup days per address — billing updates to match.</p>
            <ul className="address-list">
              {addresses.map((address) => (
                <AddressRow
                  key={address.id}
                  address={address}
                  saving={
                    updateAddressMutation.isPending && updateAddressMutation.variables?.id === address.id
                  }
                  onSave={(id, patch) => updateAddressMutation.mutate({ id, patch })}
                />
              ))}
            </ul>
            {!hasAddress ? <p className="subtext">No addresses yet — add your first one.</p> : null}
            {updateAddressMutation.isError ? (
              <p className="error">{getErrorMessage(updateAddressMutation.error)}</p>
            ) : null}
            {addressesQuery.isError ? <p className="error">{getErrorMessage(addressesQuery.error)}</p> : null}
          </article>
        </div>
      </div>
    );
  }

  function renderSchedule(): JSX.Element {
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Schedule</h2>
          <p className="subtext">Set the pickup day and cadence for an address.</p>
        </div>
        <article className="panel">
          <label>
            Address
            <select
              value={selectedAddressId}
              onChange={(event) => setSelectedAddressId(event.target.value)}
              disabled={!addressesQuery.data?.addresses.length}
            >
              <option value="">Select an address</option>
              {addressesQuery.data?.addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.line1}, {address.city}
                </option>
              ))}
            </select>
          </label>

          <form onSubmit={scheduleForm.handleSubmit((values) => scheduleMutation.mutate(values))}>
            <label>
              Pickup day (0-6)
              <input
                type="number"
                min={0}
                max={6}
                {...scheduleForm.register("pickupDayOfWeek", { valueAsNumber: true })}
              />
            </label>
            <label>
              Cadence
              <select {...scheduleForm.register("cadence")}>
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Biweekly</option>
              </select>
            </label>
            <label>
              Biweekly anchor date (ISO)
              <input {...scheduleForm.register("biweeklyAnchorDate")} placeholder="2026-08-01T00:00:00.000Z" />
            </label>
            <button type="submit" disabled={scheduleMutation.isPending || !selectedAddressId}>
              {scheduleMutation.isPending ? "Saving..." : "Save Schedule"}
            </button>
          </form>
          {scheduleMutation.isError ? <p className="error">{getErrorMessage(scheduleMutation.error)}</p> : null}
        </article>
      </div>
    );
  }

  function renderJobs(): JSX.Element {
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Upcoming Jobs</h2>
          <p className="subtext">Your scheduled pickups over the next 30 days.</p>
        </div>
        <article className="panel">
          <div className="button-row">
            <button
              type="button"
              onClick={() => generateJobsMutation.mutate()}
              disabled={generateJobsMutation.isPending}
            >
              {generateJobsMutation.isPending ? "Running scheduler…" : "Run scheduler now"}
            </button>
          </div>
          {generateJobsMutation.isSuccess ? (
            <p className={generateJobsMutation.data.created > 0 ? "success-inline" : "subtext"}>
              {generateJobsMutation.data.created > 0
                ? `Scheduled ${generateJobsMutation.data.created} job${generateJobsMutation.data.created === 1 ? "" : "s"}.`
                : "No new jobs to schedule. You need an active subscription and a saved schedule for pickups to generate."}
            </p>
          ) : null}
          {generateJobsMutation.isError ? (
            <p className="error">{getErrorMessage(generateJobsMutation.error)}</p>
          ) : null}
          <ul className="meta-list compact">
            {upcomingJobsQuery.data?.jobs.slice(0, 8).map((job) => (
              <li key={job.id}>
                {new Date(job.scheduledDate).toLocaleString()} - {job.type} ({job.status})
              </li>
            ))}
          </ul>
          {upcomingJobsQuery.data && upcomingJobsQuery.data.jobs.length === 0 ? (
            <p className="subtext">No upcoming jobs scheduled yet.</p>
          ) : null}
          {upcomingJobsQuery.isError ? <p className="error">{getErrorMessage(upcomingJobsQuery.error)}</p> : null}
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
      <Routes>
        <Route index element={renderOverview()} />
        <Route path="billing" element={renderBilling()} />
        <Route path="service-area" element={renderServiceArea()} />
        <Route path="addresses" element={renderAddresses()} />
        <Route path="schedule" element={renderSchedule()} />
        <Route path="jobs" element={renderJobs()} />
        <Route path="history" element={renderHistory()} />
        <Route path="*" element={<Navigate to="/customer" replace />} />
      </Routes>
    </section>
  );
}

function AddressRow({
  address,
  saving,
  onSave
}: {
  address: ServiceAddress;
  saving: boolean;
  onSave: (id: string, patch: { canCount: number; pickupsPerWeek: number }) => void;
}): JSX.Element {
  const [cans, setCans] = useState(address.canCount);
  const [days, setDays] = useState(address.pickupsPerWeek);
  const dirty = cans !== address.canCount || days !== address.pickupsPerWeek;
  const valid = cans >= 1 && cans <= 20 && days >= 1 && days <= 7;
  const monthly = addressMonthlyCents({
    canCount: Math.max(1, cans || 1),
    pickupsPerWeek: Math.max(1, days || 1)
  });

  return (
    <li className="address-row">
      <div className="address-row-main">
        <strong>{address.line1}</strong>
        <span className="subtext">
          {address.city}, {address.state} {address.postalCode}
        </span>
      </div>
      <div className="address-row-controls">
        <label className="field-mini">
          Cans
          <input type="number" min={1} max={20} value={cans} onChange={(event) => setCans(Number(event.target.value))} />
        </label>
        <label className="field-mini">
          Days/wk
          <input type="number" min={1} max={7} value={days} onChange={(event) => setDays(Number(event.target.value))} />
        </label>
        <span className="address-row-price">
          {formatUsd(monthly)}
          <span>/mo</span>
        </span>
        <button
          type="button"
          className="address-row-save"
          disabled={!dirty || !valid || saving}
          onClick={() => onSave(address.id, { canCount: cans, pickupsPerWeek: days })}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </li>
  );
}
