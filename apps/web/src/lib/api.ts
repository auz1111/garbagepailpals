import type {
  AdminIncidentAcknowledgeRequest,
  AdminIncidentAcknowledgeResponse,
  AdminIncidentFeed,
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7071/api";

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
  return request<undefined, ProtectedMessage>("/admin/dashboard", "GET", undefined, accessToken);
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
  return request<undefined, AdminDashboardMetrics>("/admin/dashboard", "GET", undefined, accessToken);
}

export function getAdminRuntimeMetrics(accessToken: string): Promise<AdminRuntimeMetrics> {
  return request<undefined, AdminRuntimeMetrics>("/admin/ops/runtime-metrics", "GET", undefined, accessToken);
}

export function getAdminIncidents(accessToken: string): Promise<AdminIncidentFeed> {
  return request<undefined, AdminIncidentFeed>("/admin/ops/incidents", "GET", undefined, accessToken);
}

export function acknowledgeAdminIncident(
  incidentId: string,
  input: AdminIncidentAcknowledgeRequest,
  accessToken: string
): Promise<AdminIncidentAcknowledgeResponse> {
  return request<AdminIncidentAcknowledgeRequest, AdminIncidentAcknowledgeResponse>(
    `/admin/ops/incidents/${incidentId}/acknowledge`,
    "POST",
    input,
    accessToken
  );
}

export function checkServiceArea(postalCode: string): Promise<ServiceAreaCheckResponse> {
  const params = new URLSearchParams({ postalCode });
  return request<undefined, ServiceAreaCheckResponse>(`/service-areas/check?${params.toString()}`, "GET");
}

export function listAddresses(accessToken: string): Promise<ServiceAddressListResponse> {
  return request<undefined, ServiceAddressListResponse>("/addresses", "GET", undefined, accessToken);
}

export function createAddress(input: ServiceAddressInput, accessToken: string): Promise<ServiceAddressResponse> {
  return request<ServiceAddressInput, ServiceAddressResponse>("/addresses", "POST", input, accessToken);
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
