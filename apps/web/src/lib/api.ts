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
  AdminUsersResponse,
  AdminUserResponse,
  AdminUserUpdate,
  AdminCreateUser,
  AdminRouteRequest,
  AdminRouteResponse,
  AdminRouteSummary,
  AdminTodaysLocationsResponse,
  AssignedRoutesResponse,
  DayStatusResponse,
  RouteHistoryResponse,
  ZonesResponse,
  ZoneCreate,
  ZoneUpdate,
  OperatorZonesResponse,
  NeighborhoodsResponse,
  NeighborhoodCreate,
  NeighborhoodUpdate,
  AdminLocationsResponse,
  AdminLocationNeighborhoodUpdate,
  HaulerCoverageResponse,
  AvailableOperatorsResponse,
  OperatorAvailabilityResponse,
  OperatorAvailabilityUpdate,
  AuthResponse,
  LoginInput,
  OperatorRoutesResponse,
  OperatorStopService,
  ServicePhotoUploadResponse,
  StopServiceVerificationItem,
  OperatorTimeOffResponse,
  OperatorTimeOffRequest,
  AdminOperatorsResponse,
  AdminTimeOffUpdate,
  PayPalCreateSubscriptionRequest,
  PayPalCreateSubscriptionResponse,
  BillingSummary,
  SubscriptionUpdateResponse,
  MeResponse,
  ProtectedMessage,
  RefreshInput,
  RegisterInput,
  ServiceAddress,
  ServiceAddressInput,
  CreateAddressRequest,
  PailpalCustomersResponse,
  PailpalCustomerResponse,
  PailpalCustomerCreate,
  PailpalLocationCreate,
  ServiceAreaCheckResponse,
  PickupScheduleSuggestion,
  LocationServiceInput,
  LocationServicesResponse,
  ServiceJob,
  CustomerHistoryResponse,
  PickupDay,
  ScheduleUpdateInput,
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
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
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

type ScheduleUpdateResponse = {
  schedules: PickupDay[];
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

export function getAdminRoute(accessToken: string): Promise<ProtectedMessage> {
  return request<undefined, ProtectedMessage>("/ops-admin/dashboard", "GET", undefined, accessToken);
}

export function getAdminDashboardMetrics(accessToken: string): Promise<AdminDashboardMetrics> {
  return request<undefined, AdminDashboardMetrics>("/ops-admin/dashboard", "GET", undefined, accessToken);
}

export function getAdminUsers(accessToken: string): Promise<AdminUsersResponse> {
  return request<undefined, AdminUsersResponse>("/ops-admin/users", "GET", undefined, accessToken);
}

export function createAdminUser(
  input: AdminCreateUser,
  accessToken: string
): Promise<AdminUserResponse> {
  return request<AdminCreateUser, AdminUserResponse>("/ops-admin/users", "POST", input, accessToken);
}

export function getAdminUser(userId: string, accessToken: string): Promise<AdminUserResponse> {
  return request<undefined, AdminUserResponse>(`/ops-admin/users/${userId}`, "GET", undefined, accessToken);
}

export function getTodaysRoute(
  body: AdminRouteRequest,
  accessToken: string
): Promise<AdminRouteResponse> {
  return request<AdminRouteRequest, AdminRouteResponse>(
    "/ops-admin/routes/today",
    "POST",
    body,
    accessToken
  );
}

export function getNeighborhoods(accessToken: string): Promise<NeighborhoodsResponse> {
  return request<undefined, NeighborhoodsResponse>("/ops-admin/neighborhoods", "GET", undefined, accessToken);
}

export function createNeighborhood(
  input: NeighborhoodCreate,
  accessToken: string
): Promise<NeighborhoodsResponse> {
  return request<NeighborhoodCreate, NeighborhoodsResponse>(
    "/ops-admin/neighborhoods",
    "POST",
    input,
    accessToken
  );
}

export function updateNeighborhood(
  id: string,
  patch: NeighborhoodUpdate,
  accessToken: string
): Promise<NeighborhoodsResponse> {
  return request<NeighborhoodUpdate, NeighborhoodsResponse>(
    `/ops-admin/neighborhoods/${id}`,
    "PATCH",
    patch,
    accessToken
  );
}

export function deleteNeighborhood(id: string, accessToken: string): Promise<NeighborhoodsResponse> {
  return request<undefined, NeighborhoodsResponse>(
    `/ops-admin/neighborhoods/${id}`,
    "DELETE",
    undefined,
    accessToken
  );
}

export function getAdminLocations(accessToken: string): Promise<AdminLocationsResponse> {
  return request<undefined, AdminLocationsResponse>("/ops-admin/locations", "GET", undefined, accessToken);
}

export function getHaulerCoverage(accessToken: string): Promise<HaulerCoverageResponse> {
  return request<undefined, HaulerCoverageResponse>(
    "/ops-admin/hauler-coverage",
    "GET",
    undefined,
    accessToken
  );
}

// Run the hauler lookup for an existing location and seed the cache so the
// scheduler can apply holiday shifts. Returns the resulting suggestion.
export function connectHauler(
  addressId: string,
  accessToken: string
): Promise<PickupScheduleSuggestion> {
  return request<undefined, PickupScheduleSuggestion>(
    `/ops-admin/locations/${addressId}/connect-hauler`,
    "POST",
    undefined,
    accessToken
  );
}

// Admin approves (or revokes) a location for service.
export function setLocationApproval(
  addressId: string,
  approved: boolean,
  accessToken: string
): Promise<{ ok: boolean; serviceApproved: boolean }> {
  return request<{ approved: boolean }, { ok: boolean; serviceApproved: boolean }>(
    `/ops-admin/locations/${addressId}/approval`,
    "POST",
    { approved },
    accessToken
  );
}

export function setLocationNeighborhood(
  addressId: string,
  neighborhoodId: string | null,
  accessToken: string
): Promise<{ ok: boolean }> {
  return request<AdminLocationNeighborhoodUpdate, { ok: boolean }>(
    `/ops-admin/locations/${addressId}`,
    "PATCH",
    { neighborhoodId },
    accessToken
  );
}

function scopeQuery(params: Record<string, string | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("&");
  return q ? `?${q}` : "";
}

export function getZones(accessToken: string): Promise<ZonesResponse> {
  return request<undefined, ZonesResponse>("/ops-admin/zones", "GET", undefined, accessToken);
}

export function createZone(input: ZoneCreate, accessToken: string): Promise<ZonesResponse> {
  return request<ZoneCreate, ZonesResponse>("/ops-admin/zones", "POST", input, accessToken);
}

export function updateZone(
  zoneId: string,
  input: ZoneUpdate,
  accessToken: string
): Promise<ZonesResponse> {
  return request<ZoneUpdate, ZonesResponse>(
    `/ops-admin/zones/${zoneId}`,
    "PATCH",
    input,
    accessToken
  );
}

export function deleteZone(zoneId: string, accessToken: string): Promise<ZonesResponse> {
  return request<undefined, ZonesResponse>(
    `/ops-admin/zones/${zoneId}`,
    "DELETE",
    undefined,
    accessToken
  );
}

export function setUserZones(
  userId: string,
  zoneIds: string[],
  accessToken: string
): Promise<AdminUserResponse> {
  return request<{ zoneIds: string[] }, AdminUserResponse>(
    `/ops-admin/users/${userId}/zones`,
    "PUT",
    { zoneIds },
    accessToken
  );
}

export function getAssignedRoutes(
  accessToken: string,
  zoneId?: string
): Promise<AssignedRoutesResponse> {
  return request<undefined, AssignedRoutesResponse>(
    `/ops-admin/routes/assigned${scopeQuery({ zoneId })}`,
    "GET",
    undefined,
    accessToken
  );
}

export function refreshProviderCache(
  providerId: string,
  accessToken: string
): Promise<{ ok: boolean; refreshed: number }> {
  return request<undefined, { ok: boolean; refreshed: number }>(
    `/ops-admin/hauler-coverage/providers/${encodeURIComponent(providerId)}/refresh`,
    "POST",
    undefined,
    accessToken
  );
}

export function getDayStatus(
  accessToken: string,
  scope: { zoneId?: string; neighborhoodId?: string } = {}
): Promise<DayStatusResponse> {
  return request<undefined, DayStatusResponse>(
    `/ops-admin/routes/day-status${scopeQuery(scope)}`,
    "GET",
    undefined,
    accessToken
  );
}

export function refreshDaySchedules(
  accessToken: string,
  scope: { zoneId?: string; neighborhoodId?: string } = {}
): Promise<DayStatusResponse> {
  return request<undefined, DayStatusResponse>(
    `/ops-admin/routes/refresh-schedules${scopeQuery(scope)}`,
    "POST",
    undefined,
    accessToken
  );
}

export function getRouteHistory(
  days: number,
  accessToken: string,
  zoneId?: string
): Promise<RouteHistoryResponse> {
  return request<undefined, RouteHistoryResponse>(
    `/ops-admin/routes/history${scopeQuery({ days: String(days), zoneId })}`,
    "GET",
    undefined,
    accessToken
  );
}

export function getPailpalRouteHistory(
  days: number,
  accessToken: string
): Promise<RouteHistoryResponse> {
  return request<undefined, RouteHistoryResponse>(
    `/pailpal/routes/history?days=${days}`,
    "GET",
    undefined,
    accessToken
  );
}

export function getRouteSummary(
  neighborhoodId: string | undefined,
  accessToken: string,
  zoneId?: string
): Promise<AdminRouteSummary> {
  return request<undefined, AdminRouteSummary>(
    `/ops-admin/routes/summary${scopeQuery({ neighborhoodId, zoneId })}`,
    "GET",
    undefined,
    accessToken
  );
}

export function getTodaysLocations(
  neighborhoodId: string | undefined,
  accessToken: string,
  zoneId?: string
): Promise<AdminTodaysLocationsResponse> {
  return request<undefined, AdminTodaysLocationsResponse>(
    `/ops-admin/routes/locations${scopeQuery({ neighborhoodId, zoneId })}`,
    "GET",
    undefined,
    accessToken
  );
}

export function deleteRoute(routeId: string, accessToken: string): Promise<AssignedRoutesResponse> {
  return request<undefined, AssignedRoutesResponse>(
    `/ops-admin/routes/${routeId}`,
    "DELETE",
    undefined,
    accessToken
  );
}

export function getOperatorRoutes(accessToken: string): Promise<OperatorRoutesResponse> {
  return request<undefined, OperatorRoutesResponse>("/operator/routes", "GET", undefined, accessToken);
}

export function getOperatorTimeOff(accessToken: string): Promise<OperatorTimeOffResponse> {
  return request<undefined, OperatorTimeOffResponse>("/operator/timeoff", "GET", undefined, accessToken);
}

export function requestOperatorTimeOff(
  date: string,
  accessToken: string
): Promise<OperatorTimeOffResponse> {
  return request<OperatorTimeOffRequest, OperatorTimeOffResponse>(
    "/operator/timeoff",
    "POST",
    { date },
    accessToken
  );
}

export function getAdminOperators(accessToken: string): Promise<AdminOperatorsResponse> {
  return request<undefined, AdminOperatorsResponse>("/ops-admin/operators", "GET", undefined, accessToken);
}

export function setOperatorTimeOff(
  operatorId: string,
  input: AdminTimeOffUpdate,
  accessToken: string
): Promise<AdminOperatorsResponse> {
  return request<AdminTimeOffUpdate, AdminOperatorsResponse>(
    `/ops-admin/operators/${operatorId}/timeoff`,
    "PATCH",
    input,
    accessToken
  );
}

export function acceptOperatorRoute(
  routeId: string,
  accessToken: string
): Promise<OperatorRoutesResponse> {
  return request<undefined, OperatorRoutesResponse>(
    `/operator/routes/${routeId}/accept`,
    "POST",
    undefined,
    accessToken
  );
}

// Decline an assigned route before accepting it — removes it and frees its
// locations to be reassigned.
export function declineOperatorRoute(
  routeId: string,
  accessToken: string
): Promise<OperatorRoutesResponse> {
  return request<undefined, OperatorRoutesResponse>(
    `/operator/routes/${routeId}/decline`,
    "POST",
    undefined,
    accessToken
  );
}

export function markStopServiced(
  routeId: string,
  addressId: string,
  serviced: boolean,
  accessToken: string,
  verification?: StopServiceVerificationItem[]
): Promise<OperatorRoutesResponse> {
  return request<OperatorStopService, OperatorRoutesResponse>(
    `/operator/routes/${routeId}/stops`,
    "PATCH",
    { addressId, serviced, verification },
    accessToken
  );
}

// Upload one verification photo (raw image bytes). Returns the stored blob path.
export async function uploadServicePhoto(
  file: Blob,
  accessToken: string
): Promise<ServicePhotoUploadResponse> {
  const response = await fetch(`${API_BASE_URL}/uploads/service-photo`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "image/jpeg",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: file
  });
  if (!response.ok) {
    let message = "Photo upload failed";
    try {
      message = (await response.json())?.message ?? message;
    } catch {
      // keep default
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as ServicePhotoUploadResponse;
}

// Fetch a stored verification photo (auth-gated) as an object URL for display.
export async function fetchServicePhotoUrl(path: string, accessToken: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/uploads/service-photo/${encodeURIComponent(path)}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });
  if (!response.ok) {
    throw new ApiError(response.status, "Could not load photo");
  }
  return URL.createObjectURL(await response.blob());
}

export function cancelRoute(
  routeId: string,
  reason: string | undefined,
  accessToken: string
): Promise<AssignedRoutesResponse> {
  return request<{ reason?: string }, AssignedRoutesResponse>(
    `/ops-admin/routes/${routeId}/cancel`,
    "POST",
    reason && reason.length > 0 ? { reason } : {},
    accessToken
  );
}

export function getAvailableOperators(
  date: string,
  accessToken: string,
  zoneId?: string
): Promise<AvailableOperatorsResponse> {
  return request<undefined, AvailableOperatorsResponse>(
    `/ops-admin/routes/operators${scopeQuery({ date, zoneId })}`,
    "GET",
    undefined,
    accessToken
  );
}

export function getOperatorZones(accessToken: string): Promise<OperatorZonesResponse> {
  return request<undefined, OperatorZonesResponse>(
    "/operator/zones",
    "GET",
    undefined,
    accessToken
  );
}

// Operator requests (or cancels a pending request for) a zone to serve.
export function requestOperatorZone(
  zoneId: string,
  accessToken: string
): Promise<OperatorZonesResponse> {
  return request<{ zoneId: string }, OperatorZonesResponse>(
    "/operator/zones/request",
    "POST",
    { zoneId },
    accessToken
  );
}

export function getAdminUserAvailability(
  userId: string,
  accessToken: string
): Promise<OperatorAvailabilityResponse> {
  return request<undefined, OperatorAvailabilityResponse>(
    `/ops-admin/users/${userId}/availability`,
    "GET",
    undefined,
    accessToken
  );
}

export function setAdminUserAvailability(
  userId: string,
  dates: string[],
  accessToken: string
): Promise<OperatorAvailabilityResponse> {
  return request<OperatorAvailabilityUpdate, OperatorAvailabilityResponse>(
    `/ops-admin/users/${userId}/availability`,
    "PUT",
    { dates },
    accessToken
  );
}

export function getOperatorAvailability(accessToken: string): Promise<OperatorAvailabilityResponse> {
  return request<undefined, OperatorAvailabilityResponse>(
    "/operator/availability",
    "GET",
    undefined,
    accessToken
  );
}

export function setOperatorAvailability(
  dates: string[],
  accessToken: string
): Promise<OperatorAvailabilityResponse> {
  return request<OperatorAvailabilityUpdate, OperatorAvailabilityResponse>(
    "/operator/availability",
    "PUT",
    { dates },
    accessToken
  );
}

export function updateAdminUser(
  userId: string,
  patch: AdminUserUpdate,
  accessToken: string
): Promise<AdminUserResponse> {
  return request<AdminUserUpdate, AdminUserResponse>(
    `/ops-admin/users/${userId}`,
    "PATCH",
    patch,
    accessToken
  );
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

export function checkServiceArea(
  postalCode: string,
  opts: { includeTest?: boolean } = {}
): Promise<ServiceAreaCheckResponse> {
  const params = new URLSearchParams({ postalCode });
  if (opts.includeTest) {
    params.set("includeTest", "true");
  }
  return request<undefined, ServiceAreaCheckResponse>(`/service-areas/check?${params.toString()}`, "GET");
}

// Best-effort lookup of the customer's trash hauler pickup schedule so the Add
// Location form can pre-fill the first pickup day.
export function getPickupScheduleSuggestion(
  input: { line1: string; city: string; state: string; postalCode: string },
  accessToken: string
): Promise<PickupScheduleSuggestion> {
  const params = new URLSearchParams(input);
  return request<undefined, PickupScheduleSuggestion>(
    `/service-areas/pickup-schedule?${params.toString()}`,
    "GET",
    undefined,
    accessToken
  );
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

export function createAddress(
  input: CreateAddressRequest,
  accessToken: string
): Promise<ServiceAddressResponse> {
  return request<CreateAddressRequest, ServiceAddressResponse>("/addresses", "POST", input, accessToken);
}

export function listPailpalCustomers(accessToken: string): Promise<PailpalCustomersResponse> {
  return request<undefined, PailpalCustomersResponse>("/pailpal/customers", "GET", undefined, accessToken);
}

export function createPailpalCustomer(
  input: PailpalCustomerCreate,
  accessToken: string
): Promise<PailpalCustomerResponse> {
  return request<PailpalCustomerCreate, PailpalCustomerResponse>(
    "/pailpal/customers",
    "POST",
    input,
    accessToken
  );
}

export function createPailpalLocation(
  input: PailpalLocationCreate,
  accessToken: string
): Promise<{ id: string }> {
  return request<PailpalLocationCreate, { id: string }>(
    "/pailpal/locations",
    "POST",
    input,
    accessToken
  );
}

export function approvePailpalLocation(
  addressId: string,
  approved: boolean,
  accessToken: string
): Promise<{ approved: boolean }> {
  return request<{ approved: boolean }, { approved: boolean }>(
    `/pailpal/locations/${addressId}/approve`,
    "POST",
    { approved },
    accessToken
  );
}

export function buildPailpalRoute(accessToken: string): Promise<AdminRouteResponse> {
  return request<undefined, AdminRouteResponse>("/pailpal/routes/build", "POST", undefined, accessToken);
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

export function deleteAddress(addressId: string, accessToken: string): Promise<{ deleted: boolean }> {
  return request<undefined, { deleted: boolean }>(`/addresses/${addressId}`, "DELETE", undefined, accessToken);
}

// Run the trash-provider lookup for the customer's own location (verify-pickups
// sync). Always re-fetches, bypassing the cache.
export function connectProvider(
  addressId: string,
  accessToken: string
): Promise<PickupScheduleSuggestion> {
  return request<undefined, PickupScheduleSuggestion>(
    `/addresses/${addressId}/connect-provider`,
    "POST",
    undefined,
    accessToken
  );
}

// PailPal-scoped variant: sync a managed customer's location with its trash
// provider. Same lookup, gated to the PailPal's own customers on the server.
export function connectPailpalProvider(
  addressId: string,
  accessToken: string
): Promise<PickupScheduleSuggestion> {
  return request<undefined, PickupScheduleSuggestion>(
    `/pailpal/locations/${addressId}/connect-provider`,
    "POST",
    undefined,
    accessToken
  );
}

// Generic service model: read / replace-all-write a location's services.
export function getLocationServices(
  addressId: string,
  accessToken: string
): Promise<LocationServicesResponse> {
  return request<undefined, LocationServicesResponse>(
    `/addresses/${addressId}/services`,
    "GET",
    undefined,
    accessToken
  );
}

export function updateLocationServices(
  addressId: string,
  services: LocationServiceInput[],
  accessToken: string
): Promise<LocationServicesResponse> {
  return request<{ services: LocationServiceInput[] }, LocationServicesResponse>(
    `/addresses/${addressId}/services`,
    "PUT",
    { services },
    accessToken
  );
}

export function listUpcomingJobs(accessToken: string): Promise<ServiceJobsResponse> {
  return request<undefined, ServiceJobsResponse>("/jobs/upcoming", "GET", undefined, accessToken);
}

export function listHistoryJobs(accessToken: string): Promise<CustomerHistoryResponse> {
  return request<undefined, CustomerHistoryResponse>("/jobs/history", "GET", undefined, accessToken);
}

export function getBillingSummary(accessToken: string): Promise<BillingSummary> {
  return request<undefined, BillingSummary>("/billing/summary", "GET", undefined, accessToken);
}

export function updateSubscription(
  accessToken: string,
  body: { returnUrl: string; cancelUrl: string }
): Promise<SubscriptionUpdateResponse> {
  return request<{ returnUrl: string; cancelUrl: string }, SubscriptionUpdateResponse>(
    "/subscription/update",
    "POST",
    body,
    accessToken
  );
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

export function confirmPayPalSubscription(
  subscriptionId: string,
  accessToken: string
): Promise<{ status: string; active: boolean }> {
  return request<{ subscriptionId: string }, { status: string; active: boolean }>(
    "/payments/paypal/confirm",
    "POST",
    { subscriptionId },
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
