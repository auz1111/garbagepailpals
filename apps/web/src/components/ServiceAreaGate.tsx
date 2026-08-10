import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import type { CurrentUser } from "@gpp/shared";
import { checkServiceArea, requestServiceArea } from "../lib/api";

type ServiceAreaGateProps = {
  user: CurrentUser;
  accessToken: string;
};

type GateForm = {
  postalCode: string;
};

const VERIFIED_AREA_KEY = "gpp.serviceArea";

export function ServiceAreaGate({ user, accessToken }: ServiceAreaGateProps): JSX.Element {
  const navigate = useNavigate();
  const [view, setView] = useState<"CHECK" | "UNAVAILABLE">("CHECK");
  const [checkedPostal, setCheckedPostal] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<GateForm>({ defaultValues: { postalCode: "" } });

  async function onSubmit(values: GateForm): Promise<void> {
    const postalCode = values.postalCode.trim();
    if (!postalCode) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await checkServiceArea(postalCode);
      if (result.eligible) {
        localStorage.setItem(VERIFIED_AREA_KEY, postalCode);
        navigate("/customer", { replace: true });
        return;
      }

      // Record the area they wanted so we can notify them when we expand there.
      try {
        await requestServiceArea(postalCode, accessToken);
      } catch {
        // Best-effort: still show the unavailable message even if saving fails.
      }

      setCheckedPostal(postalCode);
      setView("UNAVAILABLE");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setPending(false);
    }
  }

  if (view === "UNAVAILABLE") {
    return (
      <section className="card service-gate">
        <div className="gate-icon gate-icon-muted" aria-hidden="true">
          🔔
        </div>
        <p className="eyebrow">Not in your area yet</p>
        <h2>We're not on your block quite yet.</h2>
        <p className="subtext">
          Garbage Pail Pals doesn't service <strong>{checkedPostal}</strong> right now — but
          we're expanding fast. We'll email you at <strong>{user.email}</strong> the moment
          service opens up in your area.
        </p>
        <div className="gate-actions">
          <button
            type="button"
            className="cta-primary"
            onClick={() => {
              setView("CHECK");
              setError(null);
              form.reset({ postalCode: "" });
            }}
          >
            Check a different ZIP
          </button>
          <a className="cta-link cta-link-dark" href="/">
            Back to home
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="card service-gate">
      <div className="gate-icon" aria-hidden="true">
        📍
      </div>
      <p className="eyebrow">Getting started</p>
      <h2>Let's make sure we serve your area.</h2>
      <p className="subtext">
        Welcome, {user.name.split(" ")[0]}! Enter your ZIP code so we can confirm Garbage Pail
        Pals is available where you live before setting up your pickups.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <label>
          Postal code
          <input
            {...form.register("postalCode")}
            placeholder="97702"
            inputMode="numeric"
            autoComplete="postal-code"
            autoFocus
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Checking..." : "Check availability"}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}
