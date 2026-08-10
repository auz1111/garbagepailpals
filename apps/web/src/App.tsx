import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  loginSchema,
  registerSchema,
  type CurrentUser,
  type LoginInput,
  type Role,
  type RegisterInput
} from "@gpp/shared";
import { getMe, login, refresh, register } from "./lib/api";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { CustomerWorkspace } from "./components/CustomerWorkspace";
import { OperatorWorkspace } from "./components/OperatorWorkspace";
import { AdminWorkspace } from "./components/AdminWorkspace";

type AuthMode = "LOGIN" | "REGISTER";
const REFRESH_TOKEN_KEY = "gpp.refreshToken";

export function App() {
  const [mode, setMode] = useState<AuthMode>("LOGIN");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
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
      navigate(defaultRouteForRole(data.user.role));
    }
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      setUser(data.user);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      navigate(defaultRouteForRole(data.user.role));
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
          <h1>
            <Link to="/" className="brand-link" aria-label="Garbage Pail Pals — home">
              <img className="brand-logo" src="/logo-144.png" width={144} height={144} alt="" aria-hidden="true" />
              <span className="brand-garbage">Garbage</span> <span className="brand-pail">Pail</span> <span className="brand-pals">Pals</span>
            </Link>
          </h1>
          <nav className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/auth">Auth</Link>
            <Link to="/customer">Customer</Link>
            <Link to="/operator">Operator</Link>
            <Link to="/admin">Admin</Link>
          </nav>
          {isAuthenticated ? (
            <button type="button" onClick={logout}>
              Logout
            </button>
          ) : (
            <button type="button" onClick={goToSignIn}>
              Sign in
            </button>
          )}
        </header>

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
                  <nav className="landing-jump-links" aria-label="Homepage sections">
                    <a href="#features">Features</a>
                    <a href="#how">How it works</a>
                    <a href="#pricing">Pricing</a>
                    <a href="#contact">Contact</a>
                  </nav>
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
                      <p className="price">$19<span>/month</span></p>
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
                      <p className="price">$39<span>/month</span></p>
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
                      <p className="price">$89<span>/month</span></p>
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

                <footer className="site-footer">
                  <div className="site-footer-inner">
                    <div>
                      <div className="brand">
                        <img src="/logo-96.png" width={96} height={96} alt="" aria-hidden="true" />
                        Garbage Pail Pals
                      </div>
                      <small>Can-to-curb service, minus the scramble.</small>
                    </div>
                    <nav aria-label="Footer">
                      <a href="#features">Features</a>
                      <a href="#how">How it works</a>
                      <a href="#pricing">Pricing</a>
                      <Link to="/auth" onClick={() => setMode("LOGIN")}>Sign in</Link>
                    </nav>
                    <small>© {new Date().getFullYear()} Garbage Pail Pals</small>
                  </div>
                </footer>
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
                        <input {...registerForm.register("password")} type="password" placeholder="At least 8 chars" />
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
                        <input {...loginForm.register("password")} type="password" placeholder="Your password" />
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
            element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={["CUSTOMER", "ADMIN"]} />}
          >
            <Route
              path="/customer"
              element={
                user && accessToken ? <CustomerWorkspace user={user} accessToken={accessToken} /> : null
              }
            />
          </Route>

          <Route
            element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={["OPERATOR", "ADMIN"]} />}
          >
            <Route
              path="/operator"
              element={
                user && accessToken ? <OperatorWorkspace user={user} accessToken={accessToken} /> : null
              }
            />
          </Route>

          <Route element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={["ADMIN"]} />}>
            <Route
              path="/admin"
              element={
                user && accessToken ? <AdminWorkspace user={user} accessToken={accessToken} /> : null
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
      </section>
    </main>
  );
}

function defaultRouteForRole(role: Role): string {
  if (role === "ADMIN") {
    return "/admin";
  }

  if (role === "OPERATOR") {
    return "/operator";
  }

  return "/customer";
}
