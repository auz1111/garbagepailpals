import { useState, type FormEvent } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUser, PailpalCustomer, ScheduleCan } from "@gpp/shared";
import {
  approvePailpalLocation,
  buildPailpalRoute,
  createAddress,
  createPailpalCustomer,
  listPailpalCustomers
} from "../lib/api";
import { CanRowsEditor } from "./CanRowsEditor";
import { OperatorDashboard } from "./OperatorDashboard";

export const PAILPAL_NAV = [
  { to: "/pailpal", label: "Customers", icon: "👥", end: true },
  { to: "/pailpal/routes", label: "Today's Routes", icon: "🚛" }
] as const;

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

type PailPalWorkspaceProps = { user: CurrentUser; accessToken: string };

// --- Add a location for one managed customer ------------------------------
function AddLocationForm({
  customerId,
  accessToken,
  onDone
}: {
  customerId: string;
  accessToken: string;
  onDone: () => void;
}): JSX.Element {
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [pickupDayOfWeek, setPickupDayOfWeek] = useState(2);
  const [rollIn, setRollIn] = useState(true);
  const [cans, setCans] = useState<ScheduleCan[]>([{ type: "TRASH", cadence: "WEEKLY", count: 1 }]);

  const mutation = useMutation({
    mutationFn: () =>
      createAddress(
        {
          userId: customerId,
          line1,
          city,
          state,
          postalCode,
          pickupDayOfWeek,
          rollIn,
          cans,
          // The server geocodes the real address and derives the timezone,
          // overriding these fallbacks; canCount comes from the cans.
          lat: 0,
          lng: 0,
          timezone: "America/New_York",
          accessNotes: "",
          canCount: cans.reduce((n, c) => n + c.count, 0),
          pickupsPerWeek: 1,
          petWasteDogs: 0,
          providerSynced: false
        },
        accessToken
      ),
    onSuccess: () => {
      setLine1("");
      setCity("");
      setState("");
      setPostalCode("");
      onDone();
    }
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form className="pailpal-loc-form" onSubmit={submit}>
      <div className="pailpal-loc-grid">
        <label>
          Street
          <input value={line1} onChange={(e) => setLine1(e.target.value)} required />
        </label>
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} required />
        </label>
        <label>
          State
          <input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} required />
        </label>
        <label>
          ZIP
          <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required />
        </label>
        <label>
          Pickup day
          <select
            value={pickupDayOfWeek}
            onChange={(e) => setPickupDayOfWeek(Number(e.target.value))}
          >
            {DOW.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="pailpal-rollin">
          <input type="checkbox" checked={rollIn} onChange={(e) => setRollIn(e.target.checked)} />
          Roll cans back in
        </label>
      </div>
      <CanRowsEditor cans={cans} onChange={setCans} />
      {mutation.isError ? <p className="error">{getErrorMessage(mutation.error)}</p> : null}
      <button type="submit" className="cta-primary" disabled={mutation.isPending}>
        {mutation.isPending ? "Adding…" : "Add location"}
      </button>
    </form>
  );
}

// --- One customer card ----------------------------------------------------
function CustomerCard({
  customer,
  accessToken,
  onChanged
}: {
  customer: PailpalCustomer;
  accessToken: string;
  onChanged: () => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);

  const approveMutation = useMutation({
    mutationFn: ({ addressId, approved }: { addressId: string; approved: boolean }) =>
      approvePailpalLocation(addressId, approved, accessToken),
    onSuccess: onChanged
  });

  return (
    <li className="pailpal-customer">
      <div className="pailpal-customer-head">
        <div>
          <strong>{customer.name}</strong>
          <span className="admin-table-sub">
            {customer.email ?? "No email"}
            {customer.hasLogin ? " · Login enabled" : " · No login"}
          </span>
        </div>
        <span className="admin-table-sub">
          {customer.locations.length} location{customer.locations.length === 1 ? "" : "s"}
        </span>
      </div>

      {customer.locations.length > 0 ? (
        <ul className="pailpal-loc-list">
          {customer.locations.map((loc) => (
            <li className="pailpal-loc" key={loc.id}>
              <div>
                <strong>{loc.line1}</strong>
                <span className="admin-table-sub">
                  {loc.city}, {loc.state} {loc.postalCode}
                  {loc.pickupDays.length > 0
                    ? ` · ${loc.pickupDays.map((d) => (DOW[d] ?? "").slice(0, 3)).join(", ")}`
                    : " · no pickup day"}
                </span>
              </div>
              <div className="pailpal-loc-actions">
                <span className={`coverage-badge ${loc.serviceApproved ? "covered" : "uncovered"}`}>
                  {loc.serviceApproved ? "On route" : "Not approved"}
                </span>
                <button
                  type="button"
                  className="cta-secondary"
                  disabled={approveMutation.isPending}
                  onClick={() =>
                    approveMutation.mutate({ addressId: loc.id, approved: !loc.serviceApproved })
                  }
                >
                  {loc.serviceApproved ? "Remove from route" : "Approve for route"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="subtext">No locations yet.</p>
      )}

      {approveMutation.isError ? (
        <p className="error">{getErrorMessage(approveMutation.error)}</p>
      ) : null}

      {adding ? (
        <AddLocationForm
          customerId={customer.id}
          accessToken={accessToken}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      ) : (
        <button type="button" className="cta-secondary" onClick={() => setAdding(true)}>
          + Add location
        </button>
      )}
    </li>
  );
}

// --- Customers page -------------------------------------------------------
function PailpalCustomers({ accessToken }: { accessToken: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addLogin, setAddLogin] = useState(false);
  const [password, setPassword] = useState("");

  const customersQuery = useQuery({
    queryKey: ["pailpal-customers"],
    queryFn: async () => listPailpalCustomers(accessToken)
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["pailpal-customers"] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createPailpalCustomer(
        {
          name,
          email: email || undefined,
          phone: phone || undefined,
          addLogin,
          password: addLogin ? password : undefined
        },
        accessToken
      ),
    onSuccess: () => {
      setName("");
      setEmail("");
      setPhone("");
      setAddLogin(false);
      setPassword("");
      invalidate();
    }
  });

  const customers = customersQuery.data?.customers ?? [];

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Customers</h2>
        <p className="subtext">Your customers — add accounts, locations, and schedules.</p>
      </div>

      <article className="panel">
        <h3>Add a customer</h3>
        <form
          className="pailpal-cust-form"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            {addLogin ? "Email" : "Email (optional)"}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required={addLogin}
            />
          </label>
          <label>
            Phone (optional)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="pailpal-rollin">
            <input
              type="checkbox"
              checked={addLogin}
              onChange={(e) => setAddLogin(e.target.checked)}
            />
            Add a login for this customer
          </label>
          {addLogin ? (
            <label>
              Password
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="min 8 characters"
                required
              />
            </label>
          ) : null}
          {createMutation.isError ? (
            <p className="error">{getErrorMessage(createMutation.error)}</p>
          ) : null}
          <button type="submit" className="cta-primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create customer"}
          </button>
        </form>
      </article>

      {customersQuery.isLoading ? (
        <p className="subtext">Loading customers…</p>
      ) : customersQuery.isError ? (
        <p className="error">{getErrorMessage(customersQuery.error)}</p>
      ) : customers.length === 0 ? (
        <article className="panel">
          <p className="subtext">No customers yet. Add your first one above.</p>
        </article>
      ) : (
        <ul className="pailpal-customer-list">
          {customers.map((c) => (
            <CustomerCard key={c.id} customer={c} accessToken={accessToken} onChanged={invalidate} />
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Today's Routes page --------------------------------------------------
function PailpalRoutes({ user, accessToken }: PailPalWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const buildMutation = useMutation({
    mutationFn: () => buildPailpalRoute(accessToken),
    onSuccess: (data) => {
      const stops = data.routes.reduce((n, r) => n + r.stops.length, 0);
      setMessage(
        stops > 0
          ? `Built a route with ${stops} stop${stops === 1 ? "" : "s"}.`
          : "Nothing due today for your customers."
      );
      void queryClient.invalidateQueries({ queryKey: ["operator-routes"] });
    }
  });

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Today's Routes</h2>
        <p className="subtext">Build today's route from your customers, then accept and run it.</p>
      </div>

      <article className="panel pailpal-build">
        <button
          type="button"
          className="cta-primary"
          onClick={() => buildMutation.mutate()}
          disabled={buildMutation.isPending}
        >
          {buildMutation.isPending ? "Building…" : "Build today's route"}
        </button>
        {message ? <span className="subtext">{message}</span> : null}
        {buildMutation.isError ? (
          <p className="error">{getErrorMessage(buildMutation.error)}</p>
        ) : null}
      </article>

      <OperatorDashboard user={user} accessToken={accessToken} />
    </div>
  );
}

export function PailPalWorkspace({ user, accessToken }: PailPalWorkspaceProps): JSX.Element {
  return (
    <section className="card role-shell">
      <Routes>
        <Route index element={<PailpalCustomers accessToken={accessToken} />} />
        <Route path="routes" element={<PailpalRoutes user={user} accessToken={accessToken} />} />
        <Route path="*" element={<Navigate to="/pailpal" replace />} />
      </Routes>
    </section>
  );
}
