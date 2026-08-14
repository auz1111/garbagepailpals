import { useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUser, PailpalLocationDay, ScheduleCan } from "@gpp/shared";
import {
  approvePailpalLocation,
  buildPailpalRoute,
  createPailpalCustomer,
  createPailpalLocation,
  getOperatorRoutes,
  getPailpalRouteHistory,
  listPailpalCustomers,
  updateAddressSchedule
} from "../lib/api";
import { CanRowsEditor } from "./CanRowsEditor";
import { OperatorDashboard } from "./OperatorDashboard";
import { RouteHistory } from "./RouteHistory";

export const PAILPAL_NAV = [
  { to: "/pailpal", label: "Dashboard", icon: "📊", end: true },
  { to: "/pailpal/routes", label: "Today's Routes", icon: "🚛" },
  { to: "/pailpal/history", label: "History", icon: "🕓" },
  { to: "/pailpal/customers", label: "Customers", icon: "👥" }
] as const;

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

type PailPalWorkspaceProps = { user: CurrentUser; accessToken: string };

// --- Add a location (address only — days of service come after) -----------
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

  const mutation = useMutation({
    // Address only — the location starts with no days; the server geocodes it.
    mutationFn: () =>
      createPailpalLocation({ customerId, line1, city, state, postalCode }, accessToken),
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
      </div>
      {mutation.isError ? <p className="error">{getErrorMessage(mutation.error)}</p> : null}
      <button type="submit" className="cta-primary" disabled={mutation.isPending}>
        {mutation.isPending ? "Adding…" : "Add location"}
      </button>
    </form>
  );
}

// --- Days of service editor for one location ------------------------------
type EditableDay = {
  dayOfWeek: number;
  cans: ScheduleCan[];
  rollIn: boolean;
  biweeklyAnchorDate: string | null;
};

function LocationScheduleEditor({
  addressId,
  initialDays,
  accessToken,
  onSaved
}: {
  addressId: string;
  initialDays: PailpalLocationDay[];
  accessToken: string;
  onSaved: () => void;
}): JSX.Element {
  const [days, setDays] = useState<EditableDay[]>(
    initialDays.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      cans: d.cans,
      rollIn: d.rollIn,
      biweeklyAnchorDate: d.biweeklyAnchorDate
    }))
  );

  const save = useMutation({
    mutationFn: () =>
      updateAddressSchedule(
        addressId,
        {
          days: days.map((d) => {
            const isBiweekly = d.cans.some((c) => c.cadence === "BIWEEKLY");
            return {
              dayOfWeek: d.dayOfWeek,
              cans: d.cans,
              rollIn: d.rollIn,
              petWasteDogs: 0,
              providerSynced: false,
              // Biweekly needs a first-pickup anchor; default to today if unset.
              ...(isBiweekly
                ? { biweeklyAnchorDate: d.biweeklyAnchorDate ?? new Date().toISOString() }
                : {})
            };
          })
        },
        accessToken
      ),
    onSuccess: onSaved
  });

  const usedDays = new Set(days.map((d) => d.dayOfWeek));
  const addDay = (): void => {
    const free = [2, 1, 3, 4, 5, 0, 6].find((d) => !usedDays.has(d));
    if (free === undefined) return;
    setDays([
      ...days,
      { dayOfWeek: free, cans: [{ type: "TRASH", cadence: "WEEKLY", count: 1 }], rollIn: true, biweeklyAnchorDate: null }
    ]);
  };
  const updateDay = (i: number, patch: Partial<EditableDay>): void =>
    setDays(days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const removeDay = (i: number): void => setDays(days.filter((_, idx) => idx !== i));

  return (
    <div className="pailpal-days">
      {days.length === 0 ? (
        <p className="subtext">No days of service yet — add one below.</p>
      ) : null}
      {days.map((day, i) => (
        <div className="pailpal-day" key={i}>
          <div className="pailpal-day-head">
            <div className="pailpal-day-title">
              <span className="pailpal-day-eyebrow">
                Service day{days.length > 1 ? ` ${i + 1}` : ""}
              </span>
              <select
                className="pailpal-day-select"
                aria-label="Day of the week"
                value={day.dayOfWeek}
                onChange={(e) => updateDay(i, { dayOfWeek: Number(e.target.value) })}
              >
                {DOW.map((d, idx) => (
                  <option key={d} value={idx} disabled={idx !== day.dayOfWeek && usedDays.has(idx)}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="pailpal-day-controls">
              <button type="button" className="link-btn" onClick={() => removeDay(i)}>
                Remove
              </button>
            </div>
          </div>
          <div className="pailpal-day-cans">
            <span className="pailpal-day-cans-label">Cans serviced</span>
            <CanRowsEditor cans={day.cans} onChange={(cans) => updateDay(i, { cans })} />
            <label className="pailpal-rollin-row">
              <input
                type="checkbox"
                checked={day.rollIn}
                onChange={(e) => updateDay(i, { rollIn: e.target.checked })}
              />
              <span className="pailpal-rollin-text">
                Roll cans back in
                <span className="pailpal-rollin-hint">
                  We return the carts after the hauler collects.
                </span>
              </span>
            </label>
          </div>
        </div>
      ))}
      <div className="pailpal-days-actions">
        <button type="button" className="cta-secondary" onClick={addDay}>
          + Add day
        </button>
        {days.length > 0 ? (
          <button
            type="button"
            className="cta-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save days of service"}
          </button>
        ) : null}
      </div>
      {save.isError ? <p className="error">{getErrorMessage(save.error)}</p> : null}
    </div>
  );
}

// --- Customers list -------------------------------------------------------
function PailpalCustomers({ accessToken }: { accessToken: string }): JSX.Element {
  const customersQuery = useQuery({
    queryKey: ["pailpal-customers"],
    queryFn: async () => listPailpalCustomers(accessToken)
  });
  const customers = customersQuery.data?.customers ?? [];

  return (
    <div className="dash-page">
      <div className="dash-page-head pailpal-list-head">
        <div>
          <h2>Customers</h2>
          <p className="subtext">Select a customer to manage their locations.</p>
        </div>
        <Link to="/pailpal/customers/new" className="cta-primary">
          + Add customer
        </Link>
      </div>

      {customersQuery.isLoading ? (
        <p className="subtext">Loading customers…</p>
      ) : customersQuery.isError ? (
        <p className="error">{getErrorMessage(customersQuery.error)}</p>
      ) : customers.length === 0 ? (
        <article className="panel">
          <p className="subtext">No customers yet. Add your first one to get started.</p>
        </article>
      ) : (
        <ul className="pailpal-customer-list">
          {customers.map((c) => {
            const approved = c.locations.filter((l) => l.serviceApproved).length;
            return (
              <li key={c.id}>
                <Link to={`/pailpal/customers/${c.id}`} className="pailpal-customer-row">
                  <div className="pailpal-customer-row-main">
                    <strong>{c.name}</strong>
                    <span className="admin-table-sub">
                      {c.email ?? "No email"}
                      {c.hasLogin ? " · Login enabled" : " · No login"}
                    </span>
                  </div>
                  <span className="admin-table-sub">
                    {c.locations.length} location{c.locations.length === 1 ? "" : "s"}
                    {approved > 0 ? ` · ${approved} on route` : ""}
                  </span>
                  <span className="pailpal-row-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- New customer (its own page) ------------------------------------------
function PailpalNewCustomer({ accessToken }: { accessToken: string }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addLogin, setAddLogin] = useState(false);
  const [password, setPassword] = useState("");

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
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["pailpal-customers"] });
      // Land on the new customer's detail page so they can add locations.
      navigate(`/pailpal/customers/${data.customer.id}`);
    }
  });

  return (
    <div className="dash-page">
      <Link to="/pailpal/customers" className="back-link">
        ← Back to customers
      </Link>
      <div className="dash-page-head">
        <h2>Add a customer</h2>
        <p className="subtext">A login is optional — add one only if this customer will sign in.</p>
      </div>
      <article className="panel">
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
    </div>
  );
}

// --- Customer detail (manage locations) -----------------------------------
function PailpalCustomerDetail({ accessToken }: { accessToken: string }): JSX.Element {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const customersQuery = useQuery({
    queryKey: ["pailpal-customers"],
    queryFn: async () => listPailpalCustomers(accessToken)
  });
  const customer = customersQuery.data?.customers.find((c) => c.id === id);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["pailpal-customers"] });
  };

  const approveMutation = useMutation({
    mutationFn: ({ addressId, approved }: { addressId: string; approved: boolean }) =>
      approvePailpalLocation(addressId, approved, accessToken),
    onSuccess: invalidate
  });

  if (customersQuery.isLoading) {
    return (
      <div className="dash-page">
        <p className="subtext">Loading…</p>
      </div>
    );
  }
  if (!customer) {
    return (
      <div className="dash-page">
        <Link to="/pailpal/customers" className="back-link">
          ← Back to customers
        </Link>
        <p className="subtext">Customer not found.</p>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <Link to="/pailpal/customers" className="back-link">
        ← Back to customers
      </Link>
      <div className="dash-page-head">
        <h2>{customer.name}</h2>
        <p className="subtext">
          {customer.email ?? "No email"}
          {customer.hasLogin ? " · Login enabled" : " · No login"}
          {customer.phone ? ` · ${customer.phone}` : ""}
        </p>
      </div>

      <article className="panel">
        <div className="pailpal-list-head">
          <h3>Locations</h3>
          {!adding ? (
            <button type="button" className="cta-primary" onClick={() => setAdding(true)}>
              + Add location
            </button>
          ) : null}
        </div>

        {customer.locations.length > 0 ? (
          <ul className="pailpal-loc-list">
            {customer.locations.map((loc) => (
              <li className="pailpal-loc-block" key={loc.id}>
                <div className="pailpal-loc-head">
                  <div>
                    <strong>{loc.line1}</strong>
                    <span className="admin-table-sub">
                      {loc.city}, {loc.state} {loc.postalCode}
                    </span>
                  </div>
                  <div className="pailpal-loc-actions">
                    <span
                      className={`coverage-badge ${loc.serviceApproved ? "covered" : "uncovered"}`}
                    >
                      {loc.serviceApproved ? "On route" : "Not approved"}
                    </span>
                    <button
                      type="button"
                      className="cta-secondary"
                      disabled={approveMutation.isPending || loc.days.length === 0}
                      title={loc.days.length === 0 ? "Add days of service first" : undefined}
                      onClick={() =>
                        approveMutation.mutate({ addressId: loc.id, approved: !loc.serviceApproved })
                      }
                    >
                      {loc.serviceApproved ? "Remove from route" : "Approve for route"}
                    </button>
                  </div>
                </div>

                <div className="pailpal-days-label">Days of service</div>
                <LocationScheduleEditor
                  key={`${loc.id}:${loc.days.map((d) => d.dayOfWeek).join(",")}`}
                  addressId={loc.id}
                  initialDays={loc.days}
                  accessToken={accessToken}
                  onSaved={invalidate}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtext">No locations yet. Add the first one, then set its days of service.</p>
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
              invalidate();
            }}
          />
        ) : null}
      </article>
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

// --- Dashboard (hero + stats) ---------------------------------------------
function PailpalDashboard({ user, accessToken }: PailPalWorkspaceProps): JSX.Element {
  const customersQuery = useQuery({
    queryKey: ["pailpal-customers"],
    queryFn: async () => listPailpalCustomers(accessToken)
  });
  const routesQuery = useQuery({
    queryKey: ["operator-routes"],
    queryFn: async () => getOperatorRoutes(accessToken)
  });

  const customers = customersQuery.data?.customers ?? [];
  const locations = customers.flatMap((c) => c.locations);
  const approved = locations.filter((l) => l.serviceApproved).length;
  const stops = (routesQuery.data?.routes ?? []).flatMap((r) => r.stops);
  const serviced = stops.filter((s) => s.servicedAt).length;
  const totalStops = stops.length;

  const firstName = user.name.split(" ")[0];
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  });

  return (
    <div className="dash-page">
      <article className="pailpal-hero">
        <div className="pailpal-hero-overlay">
          <span className="routes-hero-eyebrow">Today · {today}</span>
          <h2>Welcome back, {firstName}</h2>
          <p className="routes-hero-sub">
            {totalStops > 0
              ? `${serviced}/${totalStops} stop${totalStops === 1 ? "" : "s"} serviced on today's route.`
              : "No route built for today yet — build one from Today's Routes."}
          </p>
          <div className="pailpal-hero-cta">
            <Link to="/pailpal/routes" className="cta-primary">
              Today's Routes →
            </Link>
            <Link to="/pailpal/customers" className="cta-secondary">
              Manage customers
            </Link>
          </div>
        </div>
      </article>

      <div className="pailpal-stats">
        <div className="pailpal-stat">
          <strong>{customers.length}</strong>
          <span>Customers</span>
        </div>
        <div className="pailpal-stat">
          <strong>{locations.length}</strong>
          <span>Locations</span>
        </div>
        <div className="pailpal-stat">
          <strong>{approved}</strong>
          <span>On route</span>
        </div>
        <div className="pailpal-stat">
          <strong>
            {serviced}
            <span className="pailpal-stat-frac">/{totalStops}</span>
          </strong>
          <span>Serviced today</span>
        </div>
      </div>
    </div>
  );
}

// --- History (own routes) -------------------------------------------------
function PailpalHistory({ accessToken }: { accessToken: string }): JSX.Element {
  return (
    <RouteHistory
      accessToken={accessToken}
      fetchHistory={(days, token) => getPailpalRouteHistory(days, token)}
      showZones={false}
      title="History"
      intro="Your past routes and the stops you serviced. Pick a window, then expand a route to see the detail."
    />
  );
}

export function PailPalWorkspace({ user, accessToken }: PailPalWorkspaceProps): JSX.Element {
  return (
    <section className="card role-shell">
      <Routes>
        <Route index element={<PailpalDashboard user={user} accessToken={accessToken} />} />
        <Route path="routes" element={<PailpalRoutes user={user} accessToken={accessToken} />} />
        <Route path="history" element={<PailpalHistory accessToken={accessToken} />} />
        <Route path="customers" element={<PailpalCustomers accessToken={accessToken} />} />
        <Route path="customers/new" element={<PailpalNewCustomer accessToken={accessToken} />} />
        <Route path="customers/:id" element={<PailpalCustomerDetail accessToken={accessToken} />} />
        <Route path="*" element={<Navigate to="/pailpal" replace />} />
      </Routes>
    </section>
  );
}
