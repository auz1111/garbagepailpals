import type { CanType, PickupStream } from "@gpp/shared";

// Map a provider collection stream to the can type(s) we bill/service. A stream
// is usually one can, but some haulers bundle glass + yard waste into a single
// stream (e.g. Cascade's "Glass\Yardwaste") — those are two physical carts, so
// we split them into a Glass can and a Yard can.
export function streamToCanTypes(stream: Pick<PickupStream, "kind" | "label">): CanType[] {
  const label = (stream.label ?? "").toLowerCase();
  const hasGlass = label.includes("glass");
  const hasYard = label.includes("yard");
  switch (stream.kind) {
    case "GARBAGE":
      return ["TRASH"];
    case "RECYCLING":
      return ["RECYCLING"];
    case "YARD":
      if (hasGlass && hasYard) return ["GLASS", "YARD"];
      if (hasGlass) return ["GLASS"];
      return ["YARD"];
    case "OTHER":
      return hasGlass ? ["GLASS"] : ["TRASH"];
    default:
      return ["TRASH"];
  }
}
