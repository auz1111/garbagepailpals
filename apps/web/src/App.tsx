import { Fragment, useEffect, useMemo, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  addressMonthlyCents,
  loginSchema,
  monthlyTotalCents,
  registerSchema,
  ADMIN_ROLES,
  STAFF_ROLES,
  isAdminRole,
  isSuperAdminRole,
  type CurrentUser,
  type LoginInput,
  type Role,
  type RegisterInput,
  type ScheduleCan
} from "@gpp/shared";
import {
  getAdminLocations,
  getAdminOperators,
  getBillingSummary,
  getMe,
  getOperatorRoutes,
  login,
  refresh,
  register
} from "./lib/api";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AccountPage } from "./components/AccountPage";
import { ServiceAreaGate } from "./components/ServiceAreaGate";
import { CustomerWorkspace, CUSTOMER_NAV } from "./components/CustomerWorkspace";
import { OperatorDashboard } from "./components/OperatorDashboard";
import { AdminWorkspace, ADMIN_NAV } from "./components/AdminWorkspace";
import { PailPalWorkspace, PAILPAL_NAV } from "./components/PailPalWorkspace";

type AuthMode = "LOGIN" | "REGISTER";
const REFRESH_TOKEN_KEY = "gpp.refreshToken";

// Sidebar links for an operator account.
const OPERATOR_NAV = [{ to: "/operator", label: "Operator", icon: "🚛", end: true }] as const;

// Section headers in the admin drawer, keyed by each nav item's `group`.
const NAV_SECTION_LABELS: Record<string, string> = {
  admin: "Administration",
  operators: "Operators",
  customer: "My account"
};

// Marketing plan prices are derived from the same billing engine that bills
// customers (packages/shared PRICING), so the landing page can never drift from
// what people are actually charged. Each tier is a representative configuration:
//   Starter      — one weekly pickup, 2 cans (the base price)
//   Neighborhood — two weekly pickups, 3 cans each
//   Pro Ops      — two locations, one weekly pickup each ("from" pricing)
const twoCans: ScheduleCan[] = [{ type: "TRASH", cadence: "WEEKLY", count: 2 }];
const threeCans: ScheduleCan[] = [{ type: "TRASH", cadence: "WEEKLY", count: 3 }];
const PLAN_PRICE_CENTS = {
  starter: addressMonthlyCents([{ cans: twoCans, rollIn: true }]),
  neighborhood: addressMonthlyCents([
    { cans: threeCans, rollIn: true },
    { cans: threeCans, rollIn: true }
  ]),
  proOps: monthlyTotalCents([[{ cans: twoCans, rollIn: true }], [{ cans: twoCans, rollIn: true }]])
} as const;
const wholeDollars = (cents: number): string => `$${Math.round(cents / 100)}`;

export function App() {
  const [mode, setMode] = useState<AuthMode>("LOGIN");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const registerForm = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", name: "" }
  });

  const loginForm = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  const registerMutation = useMutation({
    mutationFn: register,
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      setUser(data.user);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      // New customers must confirm we serve their area before reaching the dashboard.
      navigate(data.user.role === "CUSTOMER" ? "/service-area" : defaultRouteForRole(data.user.role));
    }
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      setUser(data.user);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      // Customers with an unresolved out-of-area request go back to the gate,
      // not the dashboard.
      const needsServiceArea = data.user.role === "CUSTOMER" && Boolean(data.user.requestedServiceArea);
      navigate(needsServiceArea ? "/service-area" : defaultRouteForRole(data.user.role));
    }
  });

  useEffect(() => {
    const bootstrapSession = async () => {
      const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!storedRefreshToken) {
        setIsBootstrapping(false);
        return;
      }

      try {
        const refreshed = await refresh({ refreshToken: storedRefreshToken });
        setAccessToken(refreshed.accessToken);
        setUser(refreshed.user);
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshed.refreshToken);
      } catch {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
      } finally {
        setIsBootstrapping(false);
      }
    };

    void bootstrapSession();
  }, []);

  useEffect(() => {
    const loadProtectedData = async () => {
      if (!accessToken || !user) {
        return;
      }

      try {
        const me = await getMe(accessToken);
        setUser(me.user);
      } catch {
        setAccessToken(null);
        setUser(null);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
      }
    };

    void loadProtectedData();
  }, [accessToken, user?.role]);

  const isAuthenticated = useMemo(() => Boolean(accessToken && user), [accessToken, user]);

  function logout() {
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    navigate("/auth");
  }

  function goToSignUp() {
    setMode("REGISTER");
    navigate("/auth");
  }

  function goToSignIn() {
    setMode("LOGIN");
    navigate("/auth");
  }

  function setRequestedArea(value: string | null) {
    setUser((prev) => (prev ? { ...prev, requestedServiceArea: value } : prev));
  }

  async function refreshUser() {
    if (!accessToken) {
      return;
    }
    try {
      const me = await getMe(accessToken);
      setUser(me.user);
    } catch {
      // Ignore — a transient refresh failure shouldn't disrupt the page.
    }
  }

  const customerBlocked = user?.role === "CUSTOMER" && Boolean(user?.requestedServiceArea);
  const isAdmin = isAdminRole(user?.role);
  const isOperator = user?.role === "OPERATOR";
  const isPailpal = user?.role === "PAILPAL";

  // Admin alert: locations with no neighborhood assigned (drives the nav badge).
  const adminLocationsQuery = useQuery({
    queryKey: ["admin-locations"],
    queryFn: async () => getAdminLocations(accessToken as string),
    enabled: isAdmin && Boolean(accessToken)
  });
  const unassignedLocationCount = (adminLocationsQuery.data?.locations ?? []).filter(
    (loc) => !loc.neighborhoodId
  ).length;

  // Operator alert: routes assigned to me that I haven't accepted yet (drives
  // the badge on the Operator nav link). Applies to operators and admins with
  // operator access.
  const canOperate = isOperator || (isAdmin && Boolean(user?.operatorAccess));
  const operatorRoutesQuery = useQuery({
    queryKey: ["operator-routes"],
    queryFn: async () => getOperatorRoutes(accessToken as string),
    enabled: canOperate && Boolean(accessToken)
  });
  const pendingRouteCount = (operatorRoutesQuery.data?.routes ?? []).filter(
    (r) => r.status === "ASSIGNED"
  ).length;

  // Admin alert: pending operator time-off requests awaiting approval.
  const adminOperatorsQuery = useQuery({
    queryKey: ["admin-operators"],
    queryFn: async () => getAdminOperators(accessToken as string),
    enabled: isAdmin && Boolean(accessToken)
  });
  const pendingTimeOffCount = (adminOperatorsQuery.data?.operators ?? []).reduce(
    (total, op) => total + op.days.filter((d) => d.status === "PENDING").length,
    0
  );

  // Customer alert: plan not active or needs updating → gold badge on Billing.
  // Shares the CustomerWorkspace query key so there's no extra fetch.
  const isCustomer = user?.role === "CUSTOMER";
  const customerBillingQuery = useQuery({
    queryKey: ["customer-billing-summary"],
    queryFn: async () => getBillingSummary(accessToken as string),
    enabled: isCustomer && !customerBlocked && Boolean(accessToken)
  });
  const billingNeedsAttention =
    isCustomer &&
    Boolean(customerBillingQuery.data) &&
    (customerBillingQuery.data?.active !== true || customerBillingQuery.data?.needsUpdate === true);
  const showDashboardMenu =
    isAuthenticated &&
    ((user?.role === "CUSTOMER" && !customerBlocked) || isAdmin || isOperator || isPailpal);
  // The admin drawer is split into clearly-labelled sections: administration,
  // the operator view, and the admin's own customer account.
  const adminOperatorSection = [
    { to: "/admin/operators", label: "Operators", icon: "🧑‍🔧", group: "operators" },
    ...(user?.operatorAccess
      ? [{ to: "/admin/operator", label: "My operator view", icon: "🚛", group: "operators" }]
      : [])
  ];
  // Super-admin-only nav items (e.g. Service Areas) are hidden from pro-operators.
  const isSuper = isSuperAdminRole(user?.role);
  const adminNav = ADMIN_NAV.filter((i) => !("superOnly" in i && i.superOnly) || isSuper).map(
    (i) => ({ ...i, group: "admin" })
  );
  // Admins/super admins can also use the app as a customer — their customer nav
  // is shown as its own section.
  const adminCustomerSection = CUSTOMER_NAV.map((i) => ({ ...i, group: "customer" }));
  const dashboardNav: ReadonlyArray<{
    to: string;
    label: string;
    icon: string;
    end?: boolean;
    group?: string;
    superOnly?: boolean;
  }> = isAdmin
    ? [...adminNav, ...adminOperatorSection, ...adminCustomerSection]
    : isPailpal
      ? PAILPAL_NAV
      : isOperator
        ? OPERATOR_NAV
        : CUSTOMER_NAV;
  const dashboardMenuLabel = isAdmin
    ? "Admin"
    : isPailpal
      ? "PailPal"
      : isOperator
        ? "Operator"
        : "Dashboard";

  const primaryActionPath = isAuthenticated && user ? defaultRouteForRole(user.role) : "/auth";

  if (isBootstrapping) {
    return (
      <main className="page">
        <section className="card">
          <h1>Garbage Pail Pals</h1>
          <p className="subtext">Restoring secure session...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="app-shell">
        <header className="topbar">
          <div className="topbar-left">
            {showDashboardMenu ? (
              <button
                type="button"
                className="hamburger"
                aria-label="Open dashboard menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
              >
                <span />
                <span />
                <span />
              </button>
            ) : null}
            <h1>
              <Link to="/" className="brand-link" aria-label="Garbage Pail Pals — home">
                <img className="brand-logo" src="/logo-144.png" width={144} height={144} alt="" aria-hidden="true" />
                <span className="brand-words">
                  <span className="brand-garbage">Garbage</span> <span className="brand-pail">Pail</span>{" "}
                  <span className="brand-pals">Pals</span>
                </span>
              </Link>
            </h1>
          </div>
          {!showDashboardMenu ? (
            <nav className="nav-links" aria-label="Primary">
              <a href="/#features">Features</a>
              <a href="/#how">How it works</a>
              <a href="/#pricing">Pricing</a>
              <a href="/#contact">Contact</a>
            </nav>
          ) : null}
          {isAuthenticated ? (
            // When the dashboard drawer is available, logout lives at the bottom
            // of the side nav; keep a header logout only where there's no drawer.
            !showDashboardMenu ? (
              <button type="button" onClick={logout}>
                Logout
              </button>
            ) : null
          ) : (
            <button type="button" onClick={goToSignIn}>
              Sign in
            </button>
          )}
        </header>

        {showDashboardMenu && menuOpen ? (
          <div className="drawer-root">
            <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />
            <aside className="drawer" aria-label="Dashboard navigation">
              <div className="drawer-head">
                <span>{dashboardMenuLabel}</span>
                <button
                  type="button"
                  className="drawer-close"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                >
                  ×
                </button>
              </div>
              {user ? (
                <Link
                  to="/account"
                  className="drawer-profile drawer-profile-link"
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="drawer-avatar" aria-hidden="true">
                    {initials(user.name)}
                  </span>
                  <span className="drawer-profile-info">
                    <strong className="drawer-profile-name">{user.name}</strong>
                    <span className="drawer-profile-role">{roleLabel(user.role)}</span>
                  </span>
                  <span className="drawer-profile-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ) : null}
              <nav className="drawer-nav">
                {dashboardNav.map((item, idx) => {
                  const isPersonalOperatorLink =
                    item.to === "/operator" || item.to === "/admin/operator";
                  const showBillingBadge = item.to === "/customer/billing" && billingNeedsAttention;
                  const badge: string | number | null =
                    item.to === "/admin/neighborhoods" && unassignedLocationCount > 0
                      ? unassignedLocationCount
                      : item.to === "/admin/operators" && pendingTimeOffCount > 0
                        ? pendingTimeOffCount
                        : isPersonalOperatorLink && pendingRouteCount > 0
                          ? pendingRouteCount
                          : showBillingBadge
                            ? "!"
                            : null;
                  // Routes awaiting acceptance and the billing prompt use the brand
                  // gold; other alerts stay red.
                  const badgeGold = (isPersonalOperatorLink && pendingRouteCount > 0) || showBillingBadge;
                  const sectionLabel =
                    item.group && item.group !== dashboardNav[idx - 1]?.group
                      ? NAV_SECTION_LABELS[item.group] ?? null
                      : null;
                  return (
                    <Fragment key={item.to}>
                      {sectionLabel ? <div className="drawer-section">{sectionLabel}</div> : null}
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) => (isActive ? "drawer-link active" : "drawer-link")}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span className="drawer-link-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                        {item.label}
                        {badge !== null ? (
                          <span
                            className={`drawer-link-badge${badgeGold ? " is-gold" : ""}`}
                            aria-label={`${badge} need attention`}
                          >
                            {badge}
                          </span>
                        ) : null}
                      </NavLink>
                    </Fragment>
                  );
                })}
              </nav>
              <div className="drawer-foot">
                <button
                  type="button"
                  className="drawer-link drawer-logout"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                >
                  <span className="drawer-link-icon" aria-hidden="true">
                    ⎋
                  </span>
                  Log out
                </button>
              </div>
            </aside>
          </div>
        ) : null}

        <Routes>
          <Route
            path="/"
            element={
              <section className="landing">
                <div className="landing-hero" id="top">
                  <p className="eyebrow">Curbside can-to-curb service</p>
                  <h2>
                    Never think about <span className="accent">trash day</span> again.
                  </h2>
                  <img
                    className="hero-logo"
                    src="/logo-hero.png"
                    width={520}
                    height={520}
                    alt="Garbage Pail Pals mascot — a smiling trash can rolling to the curb"
                  />
                  <p className="subtext">
                    Garbage Pail Pals rolls your bins to the curb and back — right on schedule.
                    Residents and operators stay in sync on one tidy dashboard so nothing slips.
                  </p>
                  <div className="landing-actions">
                    <button
                      type="button"
                      className="cta-primary"
                      onClick={() => (isAuthenticated ? navigate(primaryActionPath) : goToSignUp())}
                    >
                      {isAuthenticated ? "Go to dashboard" : "Start free trial"}
                    </button>
                    {!isAuthenticated ? (
                      <button type="button" className="cta-secondary" onClick={goToSignIn}>
                        Sign in
                      </button>
                    ) : null}
                  </div>
                </div>

                <section className="trust-bar" aria-label="At a glance">
                  <div className="trust-bar-inner">
                    <div className="trust-stat">
                      <strong>4,000+</strong>
                      <span>Bins rolled every week</span>
                    </div>
                    <div className="trust-stat">
                      <strong>99.6%</strong>
                      <span>On-time pickups</span>
                    </div>
                    <div className="trust-stat">
                      <strong>4.9★</strong>
                      <span>Average neighbor rating</span>
                    </div>
                    <div className="trust-stat">
                      <strong>0</strong>
                      <span>Missed trash days on us</span>
                    </div>
                  </div>
                </section>

                <section id="features" className="landing-band">
                  <div className="landing-band-header center">
                    <p className="eyebrow">Features</p>
                    <h3>Built for both sides of the curb.</h3>
                    <p className="subtext">
                      One platform, two tidy experiences — no phone tag, no missed cans.
                    </p>
                  </div>
                  <div className="landing-grid">
                    <article className="landing-card">
                      <div className="card-icon" aria-hidden="true">🏠</div>
                      <h4>For Residents</h4>
                      <p>Manage addresses, schedules, holds, and billing without ever calling support.</p>
                    </article>
                    <article className="landing-card">
                      <div className="card-icon" aria-hidden="true">🚚</div>
                      <h4>For Operators</h4>
                      <p>Claim upcoming jobs, update outcomes, and keep route progress crystal clear.</p>
                    </article>
                    <article className="landing-card">
                      <div className="card-icon" aria-hidden="true">🔔</div>
                      <h4>Always in the loop</h4>
                      <p>Automatic reminders and real-time job status keep everyone on the same page.</p>
                    </article>
                  </div>
                </section>

                <section id="how" className="landing-band landing-band-steps">
                  <div className="landing-band steps-inner" style={{ padding: 0 }}>
                    <div className="landing-band-header center">
                      <p className="eyebrow">How it works</p>
                      <h3>Set it once. We handle the rest.</h3>
                    </div>
                    <div className="landing-grid">
                      <article className="landing-card step-card">
                        <div className="step-num">01</div>
                        <h4>Tell us your schedule</h4>
                        <p>Add your address and pickup days. Set holds for vacations in a tap.</p>
                      </article>
                      <article className="landing-card step-card">
                        <div className="step-num">02</div>
                        <h4>We roll your bins</h4>
                        <p>An operator brings your cans to the curb the night before and back after pickup.</p>
                      </article>
                      <article className="landing-card step-card">
                        <div className="step-num">03</div>
                        <h4>Stay in the loop</h4>
                        <p>Get confirmations and reminders, and see every job's status in real time.</p>
                      </article>
                    </div>
                  </div>
                </section>

                <section id="pricing" className="landing-band">
                  <div className="landing-band-header center">
                    <p className="eyebrow">Pricing</p>
                    <h3>Simple plans with no mystery fees.</h3>
                    <p className="subtext">Every plan starts with a two-week free trial. Cancel anytime.</p>
                  </div>
                  <div className="landing-grid">
                    <article className="landing-card">
                      <h4>Starter</h4>
                      <p className="price">
                        {wholeDollars(PLAN_PRICE_CENTS.starter)}
                        <span>/month</span>
                      </p>
                      <p>For single-address households that want reliable service and reminders.</p>
                      <ul className="plan-features">
                        <li>One bin, one pickup day</li>
                        <li>Curbside roll-out &amp; return</li>
                        <li>Text &amp; email reminders</li>
                      </ul>
                      <button type="button" className="plan-cta" onClick={goToSignUp}>
                        Go Starter
                      </button>
                    </article>
                    <article className="landing-card landing-card-highlight">
                      <h4>Neighborhood</h4>
                      <p className="price">
                        {wholeDollars(PLAN_PRICE_CENTS.neighborhood)}
                        <span>/month</span>
                      </p>
                      <p>For larger households with recycling, yard waste, and frequent changes.</p>
                      <ul className="plan-features">
                        <li>Up to 3 bins</li>
                        <li>Vacation holds &amp; reschedules</li>
                        <li>Priority support</li>
                      </ul>
                      <button type="button" className="plan-cta" onClick={goToSignUp}>
                        Start free trial
                      </button>
                    </article>
                    <article className="landing-card">
                      <h4>Pro Ops</h4>
                      <p className="price">
                        <small>from </small>
                        {wholeDollars(PLAN_PRICE_CENTS.proOps)}
                        <span>/month</span>
                      </p>
                      <p>For property managers juggling multiple addresses and operator scheduling.</p>
                      <ul className="plan-features">
                        <li>Multiple addresses</li>
                        <li>Operator job assignment</li>
                        <li>Service reports &amp; history</li>
                      </ul>
                      <button type="button" className="plan-cta" onClick={goToSignUp}>
                        Go Pro Ops
                      </button>
                    </article>
                  </div>
                </section>

                <section className="testimonial" aria-label="Customer testimonial">
                  <div className="stars" aria-hidden="true">★★★★★</div>
                  <blockquote>
                    &ldquo;I genuinely forgot trash day was a chore. My cans are just always where
                    they should be.&rdquo;
                  </blockquote>
                  <cite>
                    Dana R.
                    <span>Neighborhood plan · Maple Grove</span>
                  </cite>
                </section>

                <section id="contact" className="landing-band landing-band-contact">
                  <div className="contact-inner">
                    <p className="eyebrow">Contact</p>
                    <h3>Ready to make trash day predictable?</h3>
                    <p className="subtext">
                      Create an account and jump straight to your role dashboard in seconds.
                    </p>
                    <div className="landing-actions">
                      <button type="button" className="cta-primary" onClick={goToSignUp}>
                        Get started free
                      </button>
                      <a className="cta-link" href="#top">
                        Back to top ↑
                      </a>
                    </div>
                  </div>
                </section>
              </section>
            }
          />
          <Route
            path="/auth"
            element={isAuthenticated && user ? <Navigate to={defaultRouteForRole(user.role)} replace /> : (
              <section className="card auth-card">
                <aside className="auth-promo">
                  <span className="trial-badge">✨ 14-day free trial</span>
                  <h2>Never take the bins out again.</h2>
                  <p>
                    Sign up today and we'll roll your cans to the curb and back — right on schedule,
                    week after week.
                  </p>
                  <ul className="trial-perks">
                    <li>Free for your first 14 days</li>
                    <li>No credit card required</li>
                    <li>Cancel anytime, no hassle</li>
                  </ul>
                  <p className="auth-promo-foot">
                    Join 4,000+ neighbors who never think about trash day.
                  </p>
                </aside>

                <div className="auth-form-side">
                  <div className="tabs">
                    <button type="button" className={mode === "LOGIN" ? "active" : ""} onClick={() => setMode("LOGIN")}>
                      Log in
                    </button>
                    <button
                      type="button"
                      className={mode === "REGISTER" ? "active" : ""}
                      onClick={() => setMode("REGISTER")}
                    >
                      Sign up
                    </button>
                  </div>

                  <div className="auth-head">
                    <h3>{mode === "REGISTER" ? "Start your free trial" : "Welcome back"}</h3>
                    <p className="subtext">
                      {mode === "REGISTER"
                        ? "Create your account — it takes less than a minute."
                        : "Log in to manage your pickups and schedule."}
                    </p>
                  </div>

                  {mode === "REGISTER" ? (
                    <form onSubmit={registerForm.handleSubmit((values) => registerMutation.mutate(values))}>
                      <label>
                        Name
                        <input {...registerForm.register("name")} placeholder="Chris Curb" />
                      </label>
                      <label>
                        Email
                        <input {...registerForm.register("email")} type="email" placeholder="you@example.com" />
                      </label>
                      <label>
                        Password
                        <PasswordInput
                          registration={registerForm.register("password")}
                          placeholder="At least 8 chars"
                          autoComplete="new-password"
                        />
                      </label>
                      <button type="submit" disabled={registerMutation.isPending}>
                        {registerMutation.isPending ? "Starting your trial..." : "Start my free trial"}
                      </button>
                      <p className="fineprint">No credit card required · Cancel anytime</p>
                      {registerMutation.isError ? <p className="error">{registerMutation.error.message}</p> : null}
                      <p className="auth-switch">
                        Already have an account?{" "}
                        <button type="button" className="link-inline" onClick={() => setMode("LOGIN")}>
                          Log in
                        </button>
                      </p>
                    </form>
                  ) : (
                    <form onSubmit={loginForm.handleSubmit((values) => loginMutation.mutate(values))}>
                      <label>
                        Email
                        <input {...loginForm.register("email")} type="email" placeholder="you@example.com" />
                      </label>
                      <label>
                        Password
                        <PasswordInput
                          registration={loginForm.register("password")}
                          placeholder="Your password"
                          autoComplete="current-password"
                        />
                      </label>
                      <button type="submit" disabled={loginMutation.isPending}>
                        {loginMutation.isPending ? "Signing in..." : "Sign in"}
                      </button>
                      {loginMutation.isError ? <p className="error">{loginMutation.error.message}</p> : null}
                      <p className="auth-switch">
                        New to Garbage Pail Pals?{" "}
                        <button type="button" className="link-inline" onClick={() => setMode("REGISTER")}>
                          Start a free trial
                        </button>
                      </p>
                    </form>
                  )}
                </div>
              </section>
            )}
          />

          <Route
            element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={["CUSTOMER", ...STAFF_ROLES]} />}
          >
            <Route
              path="/account"
              element={
                user && accessToken ? (
                  <AccountPage
                    user={user}
                    accessToken={accessToken}
                    refreshUser={refreshUser}
                    onLogout={logout}
                  />
                ) : null
              }
            />
          </Route>

          <Route
            element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={["CUSTOMER", ...ADMIN_ROLES]} />}
          >
            <Route
              path="/service-area"
              element={
                user && accessToken ? (
                  <ServiceAreaGate
                    user={user}
                    accessToken={accessToken}
                    onRequestedAreaChange={setRequestedArea}
                  />
                ) : null
              }
            />
            <Route
              path="/customer/*"
              element={
                user && accessToken ? (
                  customerBlocked ? (
                    <Navigate to="/service-area" replace />
                  ) : (
                    <CustomerWorkspace user={user} accessToken={accessToken} refreshUser={refreshUser} />
                  )
                ) : null
              }
            />
          </Route>

          <Route
            element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={[...STAFF_ROLES]} />}
          >
            <Route
              path="/operator"
              element={
                user && accessToken ? (
                  <section className="card role-shell">
                    <OperatorDashboard user={user} accessToken={accessToken} />
                  </section>
                ) : null
              }
            />
          </Route>

          <Route element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={[...ADMIN_ROLES]} />}>
            <Route
              path="/admin/*"
              element={
                user && accessToken ? (
                  <AdminWorkspace user={user} accessToken={accessToken} refreshUser={refreshUser} />
                ) : null
              }
            />
          </Route>

          <Route element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={["PAILPAL"]} />}>
            <Route
              path="/pailpal/*"
              element={
                user && accessToken ? (
                  <PailPalWorkspace user={user} accessToken={accessToken} />
                ) : null
              }
            />
          </Route>

          <Route
            path="/forbidden"
            element={
              <section className="card">
                <h2>Forbidden</h2>
                <p className="subtext">You are authenticated, but your role is not allowed for this route.</p>
              </section>
            }
          />
        </Routes>

        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="site-footer-brand">
              <div className="brand">
                <img src="/logo-96.png" width={96} height={96} alt="" aria-hidden="true" />
                Garbage Pail Pals
              </div>
              <p>
                Never think about trash day again. We roll your cans to the curb and back — right on
                schedule, week after week.
              </p>
            </div>
            <nav className="site-footer-nav" aria-label="Footer">
              <span className="site-footer-heading">Explore</span>
              <a href="/#features">Features</a>
              <a href="/#how">How it works</a>
              <a href="/#pricing">Pricing</a>
              <a href="/#contact">Contact</a>
            </nav>
          </div>
          <div className="site-footer-bottom">
            <span>© {new Date().getFullYear()} Garbage Pail Pals</span>
            <span>Can-to-curb service, minus the scramble.</span>
          </div>
        </footer>
      </section>
    </main>
  );
}

function PasswordInput({
  registration,
  placeholder,
  autoComplete
}: {
  registration: UseFormRegisterReturn;
  placeholder?: string;
  autoComplete?: string;
}): JSX.Element {
  const [show, setShow] = useState(false);

  return (
    <div className="password-field">
      <input
        {...registration}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setShow((prev) => !prev)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

// Initials for the profile avatar placeholder (first + last name initial).
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

// Friendly label for the signed-in user's role, shown under their name.
function roleLabel(role: Role): string {
  switch (role) {
    case "CUSTOMER":
      return "Customer";
    case "OPERATOR":
      return "Operator";
    case "PAILPAL":
      return "PailPal";
    case "PRO_OPERATOR":
      return "Pro operator";
    case "ADMIN":
      return "Admin";
    case "SUPER_ADMIN":
      return "Super admin";
    default:
      return role;
  }
}

function defaultRouteForRole(role: Role): string {
  if (isAdminRole(role)) {
    return "/admin";
  }

  if (role === "PAILPAL") {
    return "/pailpal";
  }

  if (role === "OPERATOR") {
    return "/operator";
  }

  return "/customer";
}
