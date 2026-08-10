import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { CurrentUser, ServiceAddressInput, ServiceScheduleInput } from "@gpp/shared";
import {
  ApiError,
  checkServiceArea,
  createAddress,
  createPayPalSubscription,
  createStripeCheckout,
  createStripePortal,
  listAddresses,
  listHistoryJobs,
  listUpcomingJobs,
  upsertAddressSchedule
} from "../lib/api";

type CustomerWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
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
  canCount: 1,
  isActive: true
};

const defaultScheduleValues: ServiceScheduleInput = {
  pickupDayOfWeek: 2,
  cadence: "WEEKLY",
  curbOutOffsetHours: -12,
  curbInOffsetHours: 8
};

export function CustomerWorkspace({ user, accessToken }: CustomerWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [serviceAreaResult, setServiceAreaResult] = useState<
    { postalCode: string; eligible: boolean } | null
  >(null);

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

  const createAddressMutation = useMutation({
    mutationFn: (input: ServiceAddressInput) => createAddress(input, accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
      addressForm.reset(defaultAddressValues);
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
          successUrl: window.location.href,
          cancelUrl: window.location.href
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
          returnUrl: window.location.href,
          cancelUrl: window.location.href
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
          returnUrl: window.location.href
        },
        accessToken
      ),
    onSuccess: (data) => {
      window.location.assign(data.portalUrl);
    }
  });

  const entitlementBlocked = useMemo(() => {
    const errors = [addressesQuery.error, upcomingJobsQuery.error, historyJobsQuery.error];
    return errors.some((error) => error instanceof ApiError && error.status === 402);
  }, [addressesQuery.error, historyJobsQuery.error, upcomingJobsQuery.error]);

  return (
    <section className="card role-shell customer-workspace">
      <h2>Customer Dashboard</h2>
      <p className="subtext">
        Signed in as {user.name} ({user.email})
      </p>

      <div className="panel-grid">
        <article className="panel">
          <h3>Billing</h3>
          <p className="subtext">Activate service first, then manage the subscription in Stripe.</p>
          <div className="button-row">
            <button type="button" onClick={() => stripeCheckoutMutation.mutate()} disabled={stripeCheckoutMutation.isPending}>
              {stripeCheckoutMutation.isPending ? "Redirecting..." : "Pay with Stripe"}
            </button>
            <button type="button" onClick={() => paypalCheckoutMutation.mutate()} disabled={paypalCheckoutMutation.isPending}>
              {paypalCheckoutMutation.isPending ? "Redirecting..." : "Pay with PayPal"}
            </button>
            <button type="button" onClick={() => stripePortalMutation.mutate()} disabled={stripePortalMutation.isPending}>
              {stripePortalMutation.isPending ? "Opening..." : "Open Billing Portal"}
            </button>
          </div>
          {entitlementBlocked ? (
            <p className="notice">
              Your account does not have an active entitlement yet. Complete checkout to unlock address and job features.
            </p>
          ) : null}
        </article>

        <article className="panel">
          <h3>Service Area Check</h3>
          <form
            onSubmit={serviceAreaForm.handleSubmit(async (values) => {
              const result = await checkServiceArea(values.postalCode.trim());
              setServiceAreaResult(result);
            })}
          >
            <label>
              Postal code
              <input {...serviceAreaForm.register("postalCode")} placeholder="97702" />
            </label>
            <button type="submit">Check Area</button>
          </form>
          {serviceAreaResult ? (
            <p className={serviceAreaResult.eligible ? "success-inline" : "error"}>
              {serviceAreaResult.postalCode}: {serviceAreaResult.eligible ? "In service area" : "Out of service area"}
            </p>
          ) : null}
        </article>
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
            <label>
              Can count
              <input type="number" min={1} max={20} {...addressForm.register("canCount", { valueAsNumber: true })} />
            </label>
            <button type="submit" disabled={createAddressMutation.isPending}>
              {createAddressMutation.isPending ? "Saving..." : "Save Address"}
            </button>
          </form>
          {createAddressMutation.isError ? <p className="error">{getErrorMessage(createAddressMutation.error)}</p> : null}
        </article>

        <article className="panel">
          <h3>Schedule</h3>
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

      <div className="panel-grid">
        <article className="panel">
          <h3>Upcoming Jobs (30 days)</h3>
          <ul className="meta-list compact">
            {upcomingJobsQuery.data?.jobs.slice(0, 8).map((job) => (
              <li key={job.id}>
                {new Date(job.scheduledDate).toLocaleString()} - {job.type} ({job.status})
              </li>
            ))}
          </ul>
          {upcomingJobsQuery.isError ? <p className="error">{getErrorMessage(upcomingJobsQuery.error)}</p> : null}
        </article>

        <article className="panel">
          <h3>Recent History</h3>
          <ul className="meta-list compact">
            {historyJobsQuery.data?.jobs.slice(0, 8).map((job) => (
              <li key={job.id}>
                {new Date(job.scheduledDate).toLocaleDateString()} - {job.type} ({job.status})
              </li>
            ))}
          </ul>
          {historyJobsQuery.isError ? <p className="error">{getErrorMessage(historyJobsQuery.error)}</p> : null}
        </article>
      </div>

      <article className="panel">
        <h3>Your Addresses</h3>
        <ul className="meta-list compact">
          {addressesQuery.data?.addresses.map((address) => (
            <li key={address.id}>
              {address.line1}, {address.city}, {address.state} {address.postalCode} | cans: {address.canCount}
            </li>
          ))}
        </ul>
        {addressesQuery.isError ? <p className="error">{getErrorMessage(addressesQuery.error)}</p> : null}
      </article>
    </section>
  );
}
