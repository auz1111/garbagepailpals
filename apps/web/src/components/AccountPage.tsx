import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CurrentUser } from "@gpp/shared";
import { formatUsd } from "@gpp/shared";
import {
  changePassword,
  getBillingSummary,
  signOutAllDevices,
  updateProfile
} from "../lib/api";

type Tab = "account" | "info" | "settings" | "plan";
const TABS: { key: Tab; label: string }[] = [
  { key: "account", label: "Account" },
  { key: "info", label: "My Info" },
  { key: "settings", label: "Settings" },
  { key: "plan", label: "Plan" }
];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
function roleLabel(role: string): string {
  switch (role) {
    case "CUSTOMER":
      return "Customer";
    case "OPERATOR":
      return "Operator";
    case "PAILPAL":
      return "PailPal";
    case "PRO_OPERATOR":
      return "Pro Operator";
    case "ADMIN":
      return "Admin";
    case "SUPER_ADMIN":
      return "Super Admin";
    default:
      return role;
  }
}
function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

type PageProps = {
  user: CurrentUser;
  accessToken: string;
  refreshUser: () => Promise<void>;
  onLogout: () => void;
};

export function AccountPage({ user, accessToken, refreshUser, onLogout }: PageProps): JSX.Element {
  const [tab, setTab] = useState<Tab>("account");
  return (
    <section className="card role-shell">
      <div className="dash-page account-page">
        <div className="dash-page-head">
          <h2>My Account</h2>
          <p className="subtext">Manage your profile, security, and plan.</p>
        </div>

        <nav className="account-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`account-tab${tab === t.key ? " is-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "account" ? (
          <AccountTab user={user} accessToken={accessToken} refreshUser={refreshUser} />
        ) : null}
        {tab === "info" ? <InfoTab user={user} /> : null}
        {tab === "settings" ? <SettingsTab accessToken={accessToken} onLogout={onLogout} /> : null}
        {tab === "plan" ? <PlanTab user={user} accessToken={accessToken} /> : null}
      </div>
    </section>
  );
}

// --- Account: edit name/email/phone + change password ---------------------
function AccountTab({
  user,
  accessToken,
  refreshUser
}: {
  user: CurrentUser;
  accessToken: string;
  refreshUser: () => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [saved, setSaved] = useState(false);

  const profileM = useMutation({
    mutationFn: () =>
      updateProfile({ name: name.trim(), email: email.trim(), phone: phone.trim() || null }, accessToken),
    onSuccess: async () => {
      await refreshUser();
      setSaved(true);
    }
  });

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  const passwordM = useMutation({
    mutationFn: () => changePassword({ currentPassword: current, newPassword: next }, accessToken),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwSaved(true);
      setPwError(null);
    }
  });

  const submitPassword = (e: FormEvent): void => {
    e.preventDefault();
    setPwSaved(false);
    if (next !== confirm) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwError(null);
    passwordM.mutate();
  };

  return (
    <div className="account-panels">
      <article className="panel">
        <div className="account-avatar-lg" aria-hidden="true">
          {initials(user.name)}
        </div>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            profileM.mutate();
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Phone
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Optional"
              maxLength={40}
            />
          </label>
          <button type="submit" className="cta-primary" disabled={profileM.isPending}>
            {profileM.isPending ? "Saving…" : "Update"}
          </button>
          {profileM.isError ? <p className="error">{errMsg(profileM.error)}</p> : null}
          {saved && !profileM.isPending && !profileM.isError ? (
            <p className="success-inline">Saved.</p>
          ) : null}
        </form>
      </article>

      <article className="panel">
        <h3>Change password</h3>
        <form className="account-form" onSubmit={submitPassword}>
          <label>
            Current password
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button
            type="submit"
            className="cta-primary"
            disabled={passwordM.isPending || current.length === 0 || next.length < 8}
          >
            {passwordM.isPending ? "Changing…" : "Change password"}
          </button>
          {pwError ? (
            <p className="error">{pwError}</p>
          ) : passwordM.isError ? (
            <p className="error">{errMsg(passwordM.error)}</p>
          ) : null}
          {pwSaved ? <p className="success-inline">Password changed.</p> : null}
        </form>
      </article>
    </div>
  );
}

// --- My Info: read-only account facts -------------------------------------
function InfoTab({ user }: { user: CurrentUser }): JSX.Element {
  return (
    <article className="panel">
      <h3>Account overview</h3>
      <dl className="account-facts">
        <div>
          <dt>Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{user.phone && user.phone.length > 0 ? user.phone : "—"}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>
            <span className="account-role-badge">{roleLabel(user.role)}</span>
          </dd>
        </div>
        <div>
          <dt>Member since</dt>
          <dd>{formatDate(user.createdAt)}</dd>
        </div>
        {user.requestedServiceArea ? (
          <div>
            <dt>Requested service area</dt>
            <dd>{user.requestedServiceArea}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

// --- Settings: security --------------------------------------------------
function SettingsTab({
  accessToken,
  onLogout
}: {
  accessToken: string;
  onLogout: () => void;
}): JSX.Element {
  const signOutM = useMutation({
    mutationFn: () => signOutAllDevices(accessToken),
    onSuccess: () => onLogout()
  });
  return (
    <article className="panel">
      <h3>Security</h3>
      <p className="subtext">
        Sign out of every device where you're logged in — including this one. You'll need to sign in
        again everywhere.
      </p>
      <button
        type="button"
        className="cta-secondary"
        disabled={signOutM.isPending}
        onClick={() => {
          if (window.confirm("Sign out of all devices? You'll need to sign in again.")) {
            signOutM.mutate();
          }
        }}
      >
        {signOutM.isPending ? "Signing out…" : "Sign out of all devices"}
      </button>
      {signOutM.isError ? <p className="error">{errMsg(signOutM.error)}</p> : null}
    </article>
  );
}

// --- Plan: billing (customer) or a role card (PailPal / staff) -------------
function PlanTab({ user, accessToken }: { user: CurrentUser; accessToken: string }): JSX.Element {
  const isCustomer = user.role === "CUSTOMER";
  const billingQuery = useQuery({
    queryKey: ["customer-billing-summary"],
    queryFn: async () => getBillingSummary(accessToken),
    enabled: isCustomer
  });

  if (isCustomer) {
    const b = billingQuery.data;
    const status = b?.active ? "Active" : b?.pastDue ? "Past due" : "Not active";
    return (
      <article className="panel">
        <h3>Your plan</h3>
        {billingQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : b ? (
          <dl className="account-facts">
            <div>
              <dt>Status</dt>
              <dd>{status}</dd>
            </div>
            <div>
              <dt>Monthly total</dt>
              <dd>{formatUsd(b.totalMonthlyCents)}/mo</dd>
            </div>
            {b.currentPeriodEnd ? (
              <div>
                <dt>Renews</dt>
                <dd>{formatDate(b.currentPeriodEnd)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <Link to="/customer/billing" className="cta-secondary account-plan-link">
          Manage billing
        </Link>
      </article>
    );
  }

  const isPailpal = user.role === "PAILPAL";
  return (
    <article className="panel">
      <h3>Your plan</h3>
      {isPailpal ? (
        <p className="subtext">
          As a PailPal you manage your own customers, and their billing is handled offline. A
          subscription plan for PailPals is coming soon.
        </p>
      ) : (
        <p className="subtext">
          You're on the Garbage Pail Pals team as {roleLabel(user.role)}. There's no billing plan on
          your account.
        </p>
      )}
      <dl className="account-facts">
        <div>
          <dt>Role</dt>
          <dd>
            <span className="account-role-badge">{roleLabel(user.role)}</span>
          </dd>
        </div>
        <div>
          <dt>Member since</dt>
          <dd>{formatDate(user.createdAt)}</dd>
        </div>
      </dl>
    </article>
  );
}
