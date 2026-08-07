import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUser, OperatorQueueJob } from "@gpp/shared";
import {
  claimOperatorJob,
  getOperatorQueue,
  updateOperatorJobStatus,
  type ApiError
} from "../lib/api";

type OperatorWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function OperatorWorkspace({ user, accessToken }: OperatorWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<OperatorQueueJob | null>(null);

  const queueQuery = useQuery({
    queryKey: ["operator-queue"],
    queryFn: async () => getOperatorQueue(accessToken)
  });

  const claimMutation = useMutation({
    mutationFn: (jobId: string) => claimOperatorJob(jobId, accessToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["operator-queue"] });
    }
  });

  const completeMutation = useMutation({
    mutationFn: (jobId: string) =>
      updateOperatorJobStatus(
        jobId,
        {
          status: "COMPLETED"
        },
        accessToken
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["operator-queue"] });
    }
  });

  const failMutation = useMutation({
    mutationFn: (jobId: string) =>
      updateOperatorJobStatus(
        jobId,
        {
          status: "FAILED",
          failureReason: "Operator marked failed from dashboard"
        },
        accessToken
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["operator-queue"] });
    }
  });

  const jobs = queueQuery.data?.jobs ?? [];

  return (
    <section className="card role-shell customer-workspace">
      <h2>Operator Dispatch</h2>
      <p className="subtext">
        Signed in as {user.name}. Queue window: next 7 days.
      </p>

      <div className="panel-grid">
        <article className="panel">
          <h3>Dispatch Queue</h3>
          <ul className="meta-list compact">
            {jobs.map((job) => (
              <li key={job.id}>
                <button type="button" className="link-button" onClick={() => setSelectedJob(job)}>
                  {new Date(job.scheduledDate).toLocaleString()} - {job.type} - {job.city}
                </button>
              </li>
            ))}
          </ul>
          {queueQuery.error ? <p className="error">{getErrorMessage(queueQuery.error)}</p> : null}
        </article>

        <article className="panel">
          <h3>Job Actions</h3>
          {!selectedJob ? (
            <p className="subtext">Select a job from the queue to view details and update status.</p>
          ) : (
            <>
              <p>
                <strong>{selectedJob.addressLine1}</strong>, {selectedJob.city}, {selectedJob.state} {selectedJob.postalCode}
              </p>
              <p className="subtext">Customer: {selectedJob.customerName}</p>
              <p className="subtext">Access: {selectedJob.accessNotes}</p>
              <p className="subtext">Gate: {selectedJob.gateCode ?? "none"}</p>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => claimMutation.mutate(selectedJob.id)}
                  disabled={claimMutation.isPending}
                >
                  {claimMutation.isPending ? "Claiming..." : "Claim Job"}
                </button>
                <button
                  type="button"
                  onClick={() => completeMutation.mutate(selectedJob.id)}
                  disabled={completeMutation.isPending}
                >
                  {completeMutation.isPending ? "Saving..." : "Mark Completed"}
                </button>
                <button
                  type="button"
                  onClick={() => failMutation.mutate(selectedJob.id)}
                  disabled={failMutation.isPending}
                >
                  {failMutation.isPending ? "Saving..." : "Mark Failed"}
                </button>
              </div>
              {(claimMutation.error || completeMutation.error || failMutation.error) ? (
                <p className="error">
                  {getErrorMessage(claimMutation.error ?? completeMutation.error ?? failMutation.error)}
                </p>
              ) : null}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
