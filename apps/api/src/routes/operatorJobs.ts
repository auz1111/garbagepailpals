import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  operatorJobClaimResponseSchema,
  operatorJobStatusResponseSchema,
  operatorJobStatusUpdateSchema,
  operatorQueueResponseSchema
} from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

export async function operatorQueueHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (_req, _ctx, auth) => {
        const now = new Date();
        const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const whereClause = {
          status: "SCHEDULED" as const,
          scheduledDate: { gte: now, lte: in7Days },
          ...(auth.role === "ADMIN"
            ? {}
            : {
                OR: [{ assignedOperatorId: null }, { assignedOperatorId: auth.sub }]
              })
        };

        const jobs = await prisma.serviceJob.findMany({
          where: whereClause,
          include: {
            serviceAddress: {
              include: {
                user: true
              }
            }
          },
          orderBy: { scheduledDate: "asc" },
          take: 120
        });

        const response = operatorQueueResponseSchema.parse({
          jobs: jobs.map((job: any) => ({
            id: job.id,
            serviceAddressId: job.serviceAddressId,
            subscriptionId: job.subscriptionId,
            scheduledDate: job.scheduledDate.toISOString(),
            type: job.type,
            status: job.status,
            assignedOperatorId: job.assignedOperatorId ?? null,
            customerName: job.serviceAddress.user.name,
            addressLine1: job.serviceAddress.line1,
            city: job.serviceAddress.city,
            state: job.serviceAddress.state,
            postalCode: job.serviceAddress.postalCode,
            accessNotes: job.serviceAddress.accessNotes,
            gateCode: job.serviceAddress.gateCode ?? null
          }))
        });

        return jsonResponse(200, response);
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}

export async function claimOperatorJobHandler(
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
        const jobId = req.params.jobId;
        if (!jobId) {
          return jsonResponse(400, { message: "jobId is required" });
        }

        const existing = await prisma.serviceJob.findUnique({ where: { id: jobId } });
        if (!existing) {
          return jsonResponse(404, { message: "Job not found" });
        }

        const assignedOperatorId = auth.role === "ADMIN" ? existing.assignedOperatorId ?? auth.sub : auth.sub;
        const updated = await prisma.serviceJob.update({
          where: { id: jobId },
          data: {
            assignedOperatorId
          }
        });

        await prisma.auditLog.create({
          data: {
            actorUserId: auth.sub,
            action: "operator.job.claimed",
            entityType: "ServiceJob",
            entityId: jobId,
            metadata: {
              assignedOperatorId
            }
          }
        });

        return jsonResponse(
          200,
          operatorJobClaimResponseSchema.parse({
            jobId: updated.id,
            assignedOperatorId: updated.assignedOperatorId,
            status: updated.status
          })
        );
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}

export async function updateOperatorJobStatusHandler(
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
        const jobId = req.params.jobId;
        if (!jobId) {
          return jsonResponse(400, { message: "jobId is required" });
        }

        const input = await parseJson(req, operatorJobStatusUpdateSchema);

        const existing = await prisma.serviceJob.findUnique({ where: { id: jobId } });
        if (!existing) {
          return jsonResponse(404, { message: "Job not found" });
        }

        if (auth.role !== "ADMIN") {
          if (!existing.assignedOperatorId || existing.assignedOperatorId !== auth.sub) {
            return jsonResponse(403, { message: "Only the assigned operator can update this job" });
          }
        }

        const completedAt = input.status === "COMPLETED" ? new Date() : existing.completedAt;

        const updated = await prisma.serviceJob.update({
          where: { id: jobId },
          data: {
            status: input.status,
            completedAt,
            photoBlobPath: input.photoBlobPath ?? existing.photoBlobPath,
            failureReason: input.failureReason ?? (input.status === "FAILED" ? "Failed by operator" : existing.failureReason)
          }
        });

        await prisma.auditLog.create({
          data: {
            actorUserId: auth.sub,
            action: "operator.job.status.updated",
            entityType: "ServiceJob",
            entityId: jobId,
            metadata: {
              status: input.status,
              photoBlobPath: input.photoBlobPath ?? null,
              failureReason: input.failureReason ?? null
            }
          }
        });

        return jsonResponse(
          200,
          operatorJobStatusResponseSchema.parse({
            jobId: updated.id,
            status: updated.status,
            completedAt: updated.completedAt?.toISOString() ?? null,
            failureReason: updated.failureReason ?? null,
            photoBlobPath: updated.photoBlobPath ?? null
          })
        );
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}
