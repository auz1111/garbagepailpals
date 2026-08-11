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
  confirmPayPalSubscription,
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
  deleteAddress,
  upsertAddressSchedule
} from "../lib/api";

type CustomerWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
  refreshUser: () => Promise<void>;
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
  { to: "/customer", label: "Dashboard", icon: "🧭", end: true },
  { to: "/customer/billing", label: "Billing", icon: "💳" },
  { to: "/customer/addresses", label: "Locations", icon: "🏠" },
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
  // Inline service-area check for the Add Address form.
  const [areaCheck, setAreaCheck] = useState<{ postalCode: string; eligible: boolean } | null>(null);
  const [areaChecking, setAreaChecking] = useState(false);
  // The add-address form is hidden once the user has addresses (opened via a button).
  const [showAddressForm, setShowAddressForm] = useState(false);

  const addressForm = useForm<ServiceAddressInput>({
    defaultValues: defaultAddressValues
  });

  function closeAddressForm(): void {
    setShowAddressForm(false);
    createAddressMutation.reset();
    addressForm.reset(defaultAddressValues);
    setAreaCheck(null);
  }

  async function checkAddressArea(postalCode: string): Promise<void> {
    const trimmed = postalCode.trim();
    if (!trimmed) {
      setAreaCheck(null);
      return;
    }
    setAreaChecking(true);
    try {
      const result = await checkServiceArea(trimmed);
      setAreaCheck(result);
    } catch {
      setAreaCheck(null);
    } finally {
      setAreaChecking(false);
    }
  }

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
      setAreaCheck(null);
      setShowAddressForm(false);
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

  const deleteAddressMutation = useMutation({
    mutationFn: (id: string) => deleteAddress(id, accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["customer-jobs-upcoming"] });
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

    const summary = billingSummaryQuery.data;
    const uncoveredCount = summary?.uncoveredCount ?? 0;
    const hasUncovered = Boolean(summary?.active) && uncoveredCount > 0;
    const allOk = subscriptionActive && hasAddress && !hasUncovered;

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
                "Locations — activate your subscription first"
              ) : hasAddress ? (
                `${addresses.length} location${addresses.length === 1 ? "" : "s"} added`
              ) : (
                <>
                  No location yet — <Link to="/customer/addresses">add one</Link> so we can schedule
                  pickups.
                </>
              )}
            </li>
            {hasUncovered ? (
              <li className="bad">
                {uncoveredCount === 1 ? "1 location isn't" : `${uncoveredCount} locations aren't`} on
                your plan — <Link to="/customer/billing">update your subscription</Link> to service{" "}
                {uncoveredCount === 1 ? "it" : "them"}.
              </li>
            ) : null}
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
                className="cta-secondary"
                onClick={() => stripePortalMutation.mutate()}
                disabled={stripePortalMutation.isPending}
              >
                {stripePortalMutation.isPending ? "Opening…" : "Open Billing Portal"}
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
          <h2>Locations</h2>
          <p className="subtext">Add a pickup location and review your saved locations.</p>
        </div>

        <div className={formOpen && hasAddress ? "panel-grid" : ""}>
          {formOpen ? (
          <article className="panel">
            <div className="panel-head-row">
              <h3>Add Service Location</h3>
              {hasAddress ? (
                <button type="button" className="link-inline" onClick={closeAddressForm}>
                  Cancel
                </button>
              ) : null}
            </div>
            <form onSubmit={addressForm.handleSubmit((values) => createAddressMutation.mutate(values))}>
              <label>
                Line 1
                <input
                  {...addressForm.register("line1", { required: "Street address is required" })}
                  placeholder="123 Main St"
                />
              </label>
              {addressForm.formState.errors.line1 ? (
                <p className="error">{addressForm.formState.errors.line1.message}</p>
              ) : null}
              <label>
                City
                <input {...addressForm.register("city", { required: "City is required" })} placeholder="Portland" />
              </label>
              {addressForm.formState.errors.city ? (
                <p className="error">{addressForm.formState.errors.city.message}</p>
              ) : null}
              <label>
                State
                <input
                  {...addressForm.register("state", {
                    required: "State is required",
                    minLength: { value: 2, message: "Use the 2-letter state code" }
                  })}
                  placeholder="OR"
                />
              </label>
              {addressForm.formState.errors.state ? (
                <p className="error">{addressForm.formState.errors.state.message}</p>
              ) : null}
              <label>
                Postal code
                <input
                  {...addressForm.register("postalCode", {
                    required: "Postal code is required",
                    minLength: { value: 3, message: "Enter a valid postal code" },
                    onBlur: (event) => void checkAddressArea((event.target as HTMLInputElement).value)
                  })}
                  placeholder="97702"
                />
              </label>
              {addressForm.formState.errors.postalCode ? (
                <p className="error">{addressForm.formState.errors.postalCode.message}</p>
              ) : areaChecking ? (
                <p className="subtext">Checking service area…</p>
              ) : areaCheck ? (
                <p className={areaCheck.eligible ? "success-inline" : "error"}>
                  {areaCheck.eligible
                    ? `✓ We service ${areaCheck.postalCode} — you're good to add this address.`
                    : `✗ We don't service ${areaCheck.postalCode} yet. Adding it will be rejected.`}
                </p>
              ) : null}
              <label>
                Timezone
                <input
                  {...addressForm.register("timezone", { required: "Timezone is required" })}
                  placeholder="America/Los_Angeles"
                />
              </label>
              <label>
                Access notes
                <input
                  {...addressForm.register("accessNotes", { required: "Add a note for the operator" })}
                  placeholder="Gate opens inward"
                />
              </label>
              <div className="field-row">
                <label>
                  Cans
                  <input
                    type="number"
                    min={1}
                    max={20}
                    {...addressForm.register("canCount", {
                      valueAsNumber: true,
                      required: "Required",
                      min: { value: 1, message: "Min 1" },
                      max: { value: 20, message: "Max 20" }
                    })}
                  />
                </label>
                <label>
                  Pickups per week
                  <input
                    type="number"
                    min={1}
                    max={7}
                    {...addressForm.register("pickupsPerWeek", {
                      valueAsNumber: true,
                      required: "Required",
                      min: { value: 1, message: "Min 1" },
                      max: { value: 7, message: "Max 7" }
                    })}
                  />
                </label>
              </div>
              {addressForm.formState.errors.canCount || addressForm.formState.errors.pickupsPerWeek ? (
                <p className="error">
                  {addressForm.formState.errors.canCount?.message ??
                    addressForm.formState.errors.pickupsPerWeek?.message}
                </p>
              ) : null}
              <p className="subtext">
                Defaults to {PRICING.includedCansPerAddress} cans, 1 pickup/week. More cans or pickup
                days increase your monthly cost.
              </p>
              <button type="submit" disabled={createAddressMutation.isPending}>
                {createAddressMutation.isPending ? "Saving..." : "Save Location"}
              </button>
            </form>
            {createAddressMutation.isError ? <p className="error">{getErrorMessage(createAddressMutation.error)}</p> : null}
          </article>
          ) : null}

          {hasAddress ? (
          <article className="panel">
            <div className="panel-head-row">
              <h3>Your Locations</h3>
              {!showAddressForm ? (
                <button type="button" className="add-address-btn" onClick={() => setShowAddressForm(true)}>
                  + Add Location
                </button>
              ) : null}
            </div>
            <p className="subtext">Adjust cans and pickup days per location — billing updates to match.</p>
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
                  saving={
                    updateAddressMutation.isPending && updateAddressMutation.variables?.id === address.id
                  }
                  removing={
                    deleteAddressMutation.isPending && deleteAddressMutation.variables === address.id
                  }
                  onSave={(id, patch) => updateAddressMutation.mutate({ id, patch })}
                  onRemove={(id) => {
                    if (window.confirm("Remove this location? This also cancels its scheduled pickups.")) {
                      deleteAddressMutation.mutate(id);
                    }
                  }}
                />
              ))}
            </ul>
            {updateAddressMutation.isError ? (
              <p className="error">{getErrorMessage(updateAddressMutation.error)}</p>
            ) : null}
            {deleteAddressMutation.isError ? (
              <p className="error">{getErrorMessage(deleteAddressMutation.error)}</p>
            ) : null}
            {addressesQuery.isError ? <p className="error">{getErrorMessage(addressesQuery.error)}</p> : null}
          </article>
          ) : null}
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
  covered,
  saving,
  removing,
  onSave,
  onRemove
}: {
  address: ServiceAddress;
  covered: boolean | undefined;
  saving: boolean;
  removing: boolean;
  onSave: (id: string, patch: { canCount: number; pickupsPerWeek: number }) => void;
  onRemove: (id: string) => void;
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
        {covered !== undefined ? (
          <span className={`coverage-badge ${covered ? "covered" : "uncovered"}`}>
            {covered ? "✓ Serviced" : "Not serviced"}
          </span>
        ) : null}
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
        <button
          type="button"
          className="address-row-remove"
          disabled={removing}
          aria-label="Remove address"
          onClick={() => onRemove(address.id)}
        >
          {removing ? "Removing..." : "Remove"}
        </button>
      </div>
    </li>
  );
}
