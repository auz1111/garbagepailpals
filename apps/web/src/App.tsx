import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput
} from "@gpp/shared";
import { login, register } from "./lib/api";

type AuthMode = "LOGIN" | "REGISTER";

export function App() {
  const [mode, setMode] = useState<AuthMode>("LOGIN");
  const [authState, setAuthState] = useState<AuthResponse | null>(null);

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
    onSuccess: (data) => setAuthState(data)
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => setAuthState(data)
  });

  return (
    <main className="page">
      <section className="card">
        <h1>Garbage Pail Pals</h1>
        <p className="subtext">Phase 1 scaffold with local email/password auth.</p>

        <div className="tabs">
          <button type="button" className={mode === "LOGIN" ? "active" : ""} onClick={() => setMode("LOGIN")}>
            Login
          </button>
          <button type="button" className={mode === "REGISTER" ? "active" : ""} onClick={() => setMode("REGISTER")}>
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

        {authState ? (
          <article className="success">
            <h2>Authenticated</h2>
            <p>
              Signed in as <strong>{authState.user.name}</strong> ({authState.user.role})
            </p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
