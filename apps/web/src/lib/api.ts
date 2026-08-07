import type { AuthResponse, LoginInput, RegisterInput } from "@gpp/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7071/api";

async function request<TBody, TResponse>(path: string, body?: TBody): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Request failed");
  }

  return (await response.json()) as TResponse;
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return request<RegisterInput, AuthResponse>("/auth/register", input);
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request<LoginInput, AuthResponse>("/auth/login", input);
}
