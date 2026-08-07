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
import { getAdminRoute, getMe, getOperatorRoute, login, refresh, register } from "./lib/api";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RoleShell } from "./components/RoleShell";
import { CustomerWorkspace } from "./components/CustomerWorkspace";

type AuthMode = "LOGIN" | "REGISTER";
const REFRESH_TOKEN_KEY = "gpp.refreshToken";

export function App() {
  const [mode, setMode] = useState<AuthMode>("LOGIN");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
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
        setOperatorMessage(null);
        setAdminMessage(null);
        return;
      }

      try {
        const me = await getMe(accessToken);
        setUser(me.user);
      } catch {
        setAccessToken(null);
        setUser(null);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        return;
      }

      if (user.role === "OPERATOR" || user.role === "ADMIN") {
        try {
          const operator = await getOperatorRoute(accessToken);
          setOperatorMessage(operator.message);
        } catch {
          setOperatorMessage("Operator endpoint unavailable");
        }
      } else {
        setOperatorMessage(null);
      }

      if (user.role === "ADMIN") {
        try {
          const admin = await getAdminRoute(accessToken);
          setAdminMessage(admin.message);
        } catch {
          setAdminMessage("Admin endpoint unavailable");
        }
      } else {
        setAdminMessage(null);
      }
    };

    void loadProtectedData();
  }, [accessToken, user?.role]);

  const isAuthenticated = useMemo(() => Boolean(accessToken && user), [accessToken, user]);

  function logout() {
    setAccessToken(null);
    setUser(null);
    setOperatorMessage(null);
    setAdminMessage(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    navigate("/auth");
  }

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
            <Link to="/customer">Customer</Link>
            <Link to="/operator">Operator</Link>
            <Link to="/admin">Admin</Link>
          </nav>
          <button type="button" onClick={logout} disabled={!isAuthenticated}>
            Logout
          </button>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to={user ? defaultRouteForRole(user.role) : "/auth"} replace />} />
          <Route
            path="/auth"
            element={
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
            }
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
                user ? (
                  <RoleShell
                    title="Operator Route Shell"
                    expectedRole="OPERATOR"
                    user={user}
                    apiMessage={operatorMessage}
                  />
                ) : null
              }
            />
          </Route>

          <Route element={<ProtectedRoute isAuthenticated={isAuthenticated} userRole={user?.role} allowedRoles={["ADMIN"]} />}>
            <Route
              path="/admin"
              element={
                user ? (
                  <RoleShell title="Admin Console Shell" expectedRole="ADMIN" user={user} apiMessage={adminMessage} />
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
