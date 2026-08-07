import type {
  AuthResponse,
  LoginInput,
  MeResponse,
  ProtectedMessage,
  RefreshInput,
  RegisterInput
} from "@gpp/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7071/api";

async function request<TBody, TResponse>(
  path: string,
  method: "GET" | "POST",
  body?: TBody,
  accessToken?: string
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: method === "POST" && body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Request failed");
  }

  return (await response.json()) as TResponse;
}

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
