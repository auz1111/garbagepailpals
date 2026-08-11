import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  operatorAvailabilityResponseSchema,
  operatorAvailabilityUpdateSchema
} from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// GET returns the operator's available dates; PUT replaces the whole set.
export async function operatorAvailabilityHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        if (req.method === "PUT") {
          const { dates } = await parseJson(req, operatorAvailabilityUpdateSchema);
          const unique = [...new Set(dates)];
          await prisma.$transaction([
            prisma.operatorAvailability.deleteMany({ where: { operatorId: auth.sub } }),
            prisma.operatorAvailability.createMany({
              data: unique.map((d) => ({ operatorId: auth.sub, date: new Date(`${d}T00:00:00Z`) }))
            })
          ]);
          return jsonResponse(
            200,
            operatorAvailabilityResponseSchema.parse({ dates: unique.sort() })
          );
        }

        const rows = await prisma.operatorAvailability.findMany({
          where: { operatorId: auth.sub },
          orderBy: { date: "asc" }
        });
        return jsonResponse(
          200,
          operatorAvailabilityResponseSchema.parse({ dates: rows.map((r) => toDateOnly(r.date)) })
        );
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}
