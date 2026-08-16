import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CurrentUser, PailpalCustomer, PailpalCustomerLocation } from "@gpp/shared";
import {
  approvePailpalLocation,
  buildPailpalRoute,
  connectPailpalProvider,
  createPailpalCustomer,
  createPailpalLocation,
  getOperatorRoutes,
  getPailpalRouteHistory,
  getPailpalTodaySummary,
  listPailpalCustomers
} from "../lib/api";
import { LocationServicesEditor } from "./LocationServicesEditor";
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
// One customer location: route-approval + the day-based schedule editor
// (LocationServicesEditor). Trash provider sync lives inside the editor.
function PailpalLocationBlock({
  loc,
  accessToken,
  onChanged
}: {
  loc: PailpalCustomerLocation;
  accessToken: string;
  onChanged: () => void;
}): JSX.Element {
  const approveMutation = useMutation({
    mutationFn: (approved: boolean) => approvePailpalLocation(loc.id, approved, accessToken),
    onSuccess: onChanged
  });

  // `loc.days` reflects the dual-written ServiceSchedule — a valid proxy for
  // "this location has a schedule" (gates route approval).
  const hasSchedule = loc.days.length > 0;

  return (
    <li className="pailpal-loc-block">
      <div className="pailpal-loc-head">
        <div>
          <strong>{loc.line1}</strong>
          <span className="admin-table-sub">
            {loc.city}, {loc.state} {loc.postalCode}
          </span>
        </div>
        <div className="pailpal-loc-actions">
          <span className={`coverage-badge ${loc.serviceApproved ? "covered" : "uncovered"}`}>
            {loc.serviceApproved ? "On route" : "Not approved"}
          </span>
          <button
            type="button"
            className="cta-secondary"
            disabled={approveMutation.isPending || !hasSchedule}
            title={!hasSchedule ? "Add a service first" : undefined}
            onClick={() => approveMutation.mutate(!loc.serviceApproved)}
          >
            {loc.serviceApproved ? "Remove from route" : "Approve for route"}
          </button>
        </div>
      </div>

      {approveMutation.isError ? (
        <p className="error">{getErrorMessage(approveMutation.error)}</p>
      ) : null}

      <div className="pailpal-days-label">Days of service</div>
      <LocationServicesEditor
        addressId={loc.id}
        accessToken={accessToken}
        connectProvider={connectPailpalProvider}
        onChanged={onChanged}
      />
    </li>
  );
}

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
              <PailpalLocationBlock
                key={loc.id}
                loc={loc}
                accessToken={accessToken}
                onChanged={invalidate}
              />
            ))}
          </ul>
        ) : (
          <p className="subtext">No locations yet. Add the first one, then set its days of service.</p>
        )}

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
// A customer location's status, driving its map colour and legend.
type LocStatus = "on-route" | "pending" | "setup";
const LOC_STATUS: Record<LocStatus, { color: string; label: string }> = {
  "on-route": { color: "#16a34a", label: "On route" },
  pending: { color: "#f7a81b", label: "Pending approval" },
  setup: { color: "#94a3b8", label: "Needs setup" }
};
function locStatus(loc: PailpalCustomerLocation): LocStatus {
  if (loc.serviceApproved) return "on-route";
  if (loc.days.length > 0) return "pending";
  return "setup";
}

// A map of all of a PailPal's customer locations, each pin coloured by status.
function CustomersMap({ customers }: { customers: PailpalCustomer[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: false
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const bounds: Array<[number, number]> = [];
    customers.forEach((c) => {
      c.locations.forEach((loc) => {
        const st = LOC_STATUS[locStatus(loc)];
        L.circleMarker([loc.lat, loc.lng], {
          radius: 9,
          color: "#ffffff",
          weight: 2,
          fillColor: st.color,
          fillOpacity: 1
        })
          .bindPopup(
            `<strong>${c.name}</strong><br/>${loc.line1}, ${loc.city}<br/><span style="color:${st.color};font-weight:700">${st.label}</span>`
          )
          .addTo(layer);
        bounds.push([loc.lat, loc.lng]);
      });
    });

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 15 });
    } else {
      map.setView([44.0582, -121.3153], 11); // Bend, OR fallback
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [customers]);

  return <div className="pailpal-customers-map" ref={containerRef} />;
}

function PailpalDashboard({ user, accessToken }: PailPalWorkspaceProps): JSX.Element {
  const customersQuery = useQuery({
    queryKey: ["pailpal-customers"],
    queryFn: async () => listPailpalCustomers(accessToken)
  });
  const routesQuery = useQuery({
    queryKey: ["operator-routes"],
    queryFn: async () => getOperatorRoutes(accessToken)
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // How many due stops today aren't on a route yet — gates the build button.
  const summaryQuery = useQuery({
    queryKey: ["pailpal-today-summary"],
    queryFn: async () => getPailpalTodaySummary(accessToken)
  });
  const pendingStops = summaryQuery.data?.pendingStops ?? 0;

  const buildMutation = useMutation({
    mutationFn: () => buildPailpalRoute(accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["operator-routes"] });
      void queryClient.invalidateQueries({ queryKey: ["pailpal-today-summary"] });
      navigate("/pailpal/routes");
    }
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
              : summaryQuery.isLoading
                ? "Checking today's service…"
                : pendingStops > 0
                  ? `${pendingStops} location${pendingStops === 1 ? "" : "s"} need a route today — build one below.`
                  : "No locations need service today — nothing to route right now."}
          </p>
          <div className="pailpal-hero-cta">
            {pendingStops > 0 ? (
              <button
                type="button"
                className="cta-primary"
                onClick={() => buildMutation.mutate()}
                disabled={buildMutation.isPending}
              >
                {buildMutation.isPending
                  ? "Building…"
                  : `Build today's route (${pendingStops})`}
              </button>
            ) : null}
            <Link
              to="/pailpal/routes"
              className={pendingStops > 0 ? "cta-secondary" : "cta-primary"}
            >
              Today's Routes →
            </Link>
            <Link to="/pailpal/customers" className="cta-secondary">
              Manage customers
            </Link>
          </div>
          {buildMutation.isError ? (
            <p className="pailpal-hero-error">Couldn't build the route — please try again.</p>
          ) : null}
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

      <article className="panel">
        <div className="pailpal-list-head">
          <h3>Customer map</h3>
          <div className="pailpal-map-legend">
            {(Object.keys(LOC_STATUS) as LocStatus[]).map((k) => (
              <span key={k} className="pailpal-map-legend-item">
                <span className="pailpal-map-dot" style={{ background: LOC_STATUS[k].color }} />
                {LOC_STATUS[k].label}
              </span>
            ))}
          </div>
        </div>
        {locations.length > 0 ? (
          <CustomersMap customers={customers} />
        ) : (
          <p className="subtext">No customer locations yet — add a customer to see them on the map.</p>
        )}
      </article>
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
