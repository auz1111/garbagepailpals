import type {
  AdminIncidentAssignRequest,
  AdminIncidentAssignResponse,
  AdminIncidentAcknowledgeRequest,
  AdminIncidentAcknowledgeResponse,
  AdminIncidentFeed,
  AdminIncidentReopenRequest,
  AdminIncidentReopenResponse,
  AdminIncidentResolveRequest,
  AdminIncidentResolveResponse,
  AdminRuntimeMetrics,
  AdminDashboardMetrics,
  AuthResponse,
  LoginInput,
  OperatorJobClaimResponse,
  OperatorJobStatusResponse,
  OperatorJobStatusUpdate,
  OperatorQueueResponse,
  PayPalCreateSubscriptionRequest,
  PayPalCreateSubscriptionResponse,
  MeResponse,
  ProtectedMessage,
  RefreshInput,
  RegisterInput,
  ServiceAddress,
  ServiceAddressInput,
  ServiceAreaCheckResponse,
  ServiceJob,
  ServiceSchedule,
  ServiceScheduleInput,
  StripeCheckoutRequest,
  StripeCheckoutResponse,
  StripePortalRequest,
  StripePortalResponse
} from "@gpp/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:7071/api" : "https://func-gpp-prod.azurewebsites.net/api");

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<TBody, TResponse>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT",
  body?: TBody,
  accessToken?: string
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: (method === "POST" || method === "PATCH" || method === "PUT") && body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(response.status, payload.message ?? "Request failed");
  }

  return (await response.json()) as TResponse;
}

type ServiceAddressListResponse = {
  addresses: ServiceAddress[];
};

type ServiceAddressResponse = {
  address: ServiceAddress;
};

type ServiceScheduleResponse = {
  schedule: ServiceSchedule;
};

type ServiceJobsResponse = {
  jobs: ServiceJob[];
};

export type AdminIncidentFilter = {
  state?: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  source?: "JOB" | "NOTIFICATION" | "WEBHOOK";
  severity?: "WARN" | "CRITICAL";
  // "__unassigned" filters incidents with no ownerUserId.
  ownerUserId?: string;
};

export function register(input: RegisterInput): Promise<AuthResponse> {
  return request<RegisterInput, AuthResponse>("/auth/register", "POST", input);
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request<LoginInput, AuthResponse>("/auth/login", "POST", input);
}

export function refresh(input: RefreshInput): Promise<AuthResponse> {
  return request<RefreshInput, AuthResponse>("/auth/refresh", "POST", input);
}

export function getMe(accessToken: string): Promise<MeResponse> {
  return request<undefined, MeResponse>("/auth/me", "GET", undefined, accessToken);
}

export function getOperatorRoute(accessToken: string): Promise<ProtectedMessage> {
  return request<undefined, ProtectedMessage>("/operator/jobs", "GET", undefined, accessToken);
}

export function getAdminRoute(accessToken: string): Promise<ProtectedMessage> {
  return request<undefined, ProtectedMessage>("/ops-admin/dashboard", "GET", undefined, accessToken);
}

export function getOperatorQueue(accessToken: string): Promise<OperatorQueueResponse> {
  return request<undefined, OperatorQueueResponse>("/operator/jobs", "GET", undefined, accessToken);
}

export function claimOperatorJob(jobId: string, accessToken: string): Promise<OperatorJobClaimResponse> {
  return request<undefined, OperatorJobClaimResponse>(`/operator/jobs/${jobId}/claim`, "POST", undefined, accessToken);
}

export function updateOperatorJobStatus(
  jobId: string,
  input: OperatorJobStatusUpdate,
  accessToken: string
): Promise<OperatorJobStatusResponse> {
  return request<OperatorJobStatusUpdate, OperatorJobStatusResponse>(
    `/operator/jobs/${jobId}/status`,
    "PATCH",
    input,
    accessToken
  );
}

export function getAdminDashboardMetrics(accessToken: string): Promise<AdminDashboardMetrics> {
  return request<undefined, AdminDashboardMetrics>("/ops-admin/dashboard", "GET", undefined, accessToken);
}

export function getAdminRuntimeMetrics(accessToken: string): Promise<AdminRuntimeMetrics> {
  return request<undefined, AdminRuntimeMetrics>("/ops-admin/runtime-metrics", "GET", undefined, accessToken);
}

export function getAdminIncidents(accessToken: string, filter?: AdminIncidentFilter): Promise<AdminIncidentFeed> {
  const params = new URLSearchParams();
  if (filter?.state) {
    params.set("state", filter.state);
  }
  if (filter?.source) {
    params.set("source", filter.source);
  }
  if (filter?.severity) {
    params.set("severity", filter.severity);
  }
  if (filter?.ownerUserId) {
    params.set("ownerUserId", filter.ownerUserId);
  }

  const query = params.toString();
  const path = query ? `/ops-admin/incidents?${query}` : "/ops-admin/incidents";
  return request<undefined, AdminIncidentFeed>(path, "GET", undefined, accessToken);
}

export function acknowledgeAdminIncident(
  incidentId: string,
  input: AdminIncidentAcknowledgeRequest,
  accessToken: string
): Promise<AdminIncidentAcknowledgeResponse> {
  return request<AdminIncidentAcknowledgeRequest, AdminIncidentAcknowledgeResponse>(
    `/ops-admin/incidents/${incidentId}/acknowledge`,
    "POST",
    input,
    accessToken
  );
}

export function assignAdminIncident(
  incidentId: string,
  input: AdminIncidentAssignRequest,
  accessToken: string
): Promise<AdminIncidentAssignResponse> {
  return request<AdminIncidentAssignRequest, AdminIncidentAssignResponse>(
    `/ops-admin/incidents/${incidentId}/assign`,
    "POST",
    input,
    accessToken
  );
}

export function resolveAdminIncident(
  incidentId: string,
  input: AdminIncidentResolveRequest,
  accessToken: string
): Promise<AdminIncidentResolveResponse> {
  return request<AdminIncidentResolveRequest, AdminIncidentResolveResponse>(
    `/ops-admin/incidents/${incidentId}/resolve`,
    "POST",
    input,
    accessToken
  );
}

export function reopenAdminIncident(
  incidentId: string,
  input: AdminIncidentReopenRequest,
  accessToken: string
): Promise<AdminIncidentReopenResponse> {
  return request<AdminIncidentReopenRequest, AdminIncidentReopenResponse>(
    `/ops-admin/incidents/${incidentId}/reopen`,
    "POST",
    input,
    accessToken
  );
}

export function checkServiceArea(postalCode: string): Promise<ServiceAreaCheckResponse> {
  const params = new URLSearchParams({ postalCode });
  return request<undefined, ServiceAreaCheckResponse>(`/service-areas/check?${params.toString()}`, "GET");
}

type ServiceAreaRequestResponse = {
  postalCode: string;
  eligible: boolean;
};

export function requestServiceArea(
  postalCode: string,
  accessToken: string
): Promise<ServiceAreaRequestResponse> {
  return request<{ postalCode: string }, ServiceAreaRequestResponse>(
    "/service-areas/request",
    "POST",
    { postalCode },
    accessToken
  );
}

export function listAddresses(accessToken: string): Promise<ServiceAddressListResponse> {
  return request<undefined, ServiceAddressListResponse>("/addresses", "GET", undefined, accessToken);
}

export function createAddress(input: ServiceAddressInput, accessToken: string): Promise<ServiceAddressResponse> {
  return request<ServiceAddressInput, ServiceAddressResponse>("/addresses", "POST", input, accessToken);
}

export function updateAddress(
  addressId: string,
  input: Partial<ServiceAddressInput>,
  accessToken: string
): Promise<ServiceAddressResponse> {
  return request<Partial<ServiceAddressInput>, ServiceAddressResponse>(
    `/addresses/${addressId}`,
    "PATCH",
    input,
    accessToken
  );
}

export function upsertAddressSchedule(
  addressId: string,
  input: ServiceScheduleInput,
  accessToken: string
): Promise<ServiceScheduleResponse> {
  return request<ServiceScheduleInput, ServiceScheduleResponse>(
    `/addresses/${addressId}/schedule`,
    "PUT",
    input,
    accessToken
  );
}

export function listUpcomingJobs(accessToken: string): Promise<ServiceJobsResponse> {
  return request<undefined, ServiceJobsResponse>("/jobs/upcoming", "GET", undefined, accessToken);
}

export function listHistoryJobs(accessToken: string): Promise<ServiceJobsResponse> {
  return request<undefined, ServiceJobsResponse>("/jobs/history", "GET", undefined, accessToken);
}

export function generateJobs(accessToken: string): Promise<{ created: number }> {
  return request<undefined, { created: number }>("/jobs/generate", "POST", undefined, accessToken);
}

export function createStripeCheckout(
  input: StripeCheckoutRequest,
  accessToken: string
): Promise<StripeCheckoutResponse> {
  return request<StripeCheckoutRequest, StripeCheckoutResponse>(
    "/payments/stripe/checkout-session",
    "POST",
    input,
    accessToken
  );
}

export function createStripePortal(
  input: StripePortalRequest,
  accessToken: string
): Promise<StripePortalResponse> {
  return request<StripePortalRequest, StripePortalResponse>(
    "/payments/stripe/customer-portal",
    "POST",
    input,
    accessToken
  );
}

export function createPayPalSubscription(
  input: PayPalCreateSubscriptionRequest,
  accessToken: string
): Promise<PayPalCreateSubscriptionResponse> {
  return request<PayPalCreateSubscriptionRequest, PayPalCreateSubscriptionResponse>(
    "/payments/paypal/subscriptions",
    "POST",
    input,
    accessToken
  );
}
