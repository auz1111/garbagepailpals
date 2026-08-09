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
          <h1>Garbage Pail Pals</h1>
          <nav className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/auth">Auth</Link>
            <Link to="/customer">Customer</Link>
            <Link to="/operator">Operator</Link>
            <Link to="/admin">Admin</Link>
          </nav>
          <button type="button" onClick={logout} disabled={!isAuthenticated}>
            Logout
          </button>
        </header>

        <Routes>
          <Route
            path="/"
            element={
              <section className="landing">
                <div className="landing-hero" id="top">
                  <p className="eyebrow">Neighborhood curbside coordination</p>
                  <h2>Garbage day, minus the scramble.</h2>
                  <p className="subtext">
                    One place for residents, operators, and admins to keep pickups on schedule and visible.
                  </p>
                  <div className="landing-actions">
                    <button type="button" className="cta-primary" onClick={() => navigate(primaryActionPath)}>
                      {isAuthenticated ? "Go to dashboard" : "Sign in"}
                    </button>
                    {!isAuthenticated ? (
                      <button type="button" className="cta-secondary" onClick={() => navigate("/auth")}>
                        Create account
                      </button>
                    ) : null}
                  </div>
                  <nav className="landing-jump-links" aria-label="Homepage sections">
                    <a href="#features">Features</a>
                    <a href="#pricing">Pricing</a>
                    <a href="#contact">Contact</a>
                  </nav>
                </div>

                <section id="features" className="landing-band">
                  <div className="landing-band-header">
                    <p className="eyebrow">Features</p>
                    <h3>Built for everyone in the pickup loop.</h3>
                  </div>
                  <div className="landing-grid">
                    <article className="landing-card">
                      <h4>For Customers</h4>
                      <p>Manage addresses, schedules, holds, and billing without calling support.</p>
                    </article>
                    <article className="landing-card">
                      <h4>For Operators</h4>
                      <p>Claim upcoming jobs, update outcomes, and keep route progress clean.</p>
                    </article>
                    <article className="landing-card">
                      <h4>For Admins</h4>
                      <p>See incidents, runtime health, and service metrics in one control panel.</p>
                    </article>
                  </div>
                </section>

                <section id="pricing" className="landing-band">
                  <div className="landing-band-header">
                    <p className="eyebrow">Pricing</p>
                    <h3>Simple plans with no mystery fees.</h3>
                  </div>
                  <div className="landing-grid">
                    <article className="landing-card">
                      <h4>Starter</h4>
                      <p className="price">$19<span>/month</span></p>
                      <p>Perfect for single-address households that want reliable reminders.</p>
                    </article>
                    <article className="landing-card landing-card-highlight">
                      <h4>Neighborhood</h4>
                      <p className="price">$39<span>/month</span></p>
                      <p>Great for larger households and frequent service changes.</p>
                    </article>
                    <article className="landing-card">
                      <h4>Pro Ops</h4>
                      <p className="price">$89<span>/month</span></p>
                      <p>Includes operator workflow support and admin reporting dashboards.</p>
                    </article>
                  </div>
                </section>

                <section id="contact" className="landing-band landing-band-contact">
                  <div className="landing-band-header">
                    <p className="eyebrow">Contact</p>
                    <h3>Ready to make pickup day predictable?</h3>
                    <p className="subtext">
                      Start with an account and switch to your role dashboard in seconds.
                    </p>
                  </div>
                  <div className="landing-actions">
                    <button type="button" className="cta-primary" onClick={() => navigate("/auth")}>
                      Get started
                    </button>
                    <a className="cta-link" href="#top">
                      Back to top
                    </a>
                  </div>
                </section>
              </section>
            }
          />
          <Route
            path="/auth"
            element={isAuthenticated && user ? <Navigate to={defaultRouteForRole(user.role)} replace /> : (
              <section className="card">
                <p className="subtext">Phase 3 auth + role shells.</p>
                <div className="tabs">
                  <button type="button" className={mode === "LOGIN" ? "active" : ""} onClick={() => setMode("LOGIN")}>
                    Login
                  </button>
                  <button
                    type="button"
                    className={mode === "REGISTER" ? "active" : ""}
                    onClick={() => setMode("REGISTER")}
                  >
                    Register
                  </button>
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
                      {registerMutation.isPending ? "Creating account..." : "Create account"}
                    </button>
                    {registerMutation.isError ? <p className="error">{registerMutation.error.message}</p> : null}
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
                  </form>
                )}
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
