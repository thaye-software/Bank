import { getToken, clearToken } from "./auth";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers ?? {}),
  };

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new ApiError("UNAUTHORIZED", "Session expired", 401);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let body: {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
  };
  try {
    body = (await res.json()) as {
      success: boolean;
      data?: T;
      error?: { code: string; message: string };
    };
  } catch (_err) {
    // If response is not JSON (e.g., 429 from misconfigured rate limiter), provide fallback
    const message =
      res.status === 429
        ? "Too many requests. Please try again later."
        : `HTTP ${res.status}: Invalid server response`;
    throw new ApiError("SERVER_ERROR", message, res.status);
  }

  if (!body.success || !res.ok) {
    const err = body.error ?? {
      code: "UNKNOWN_ERROR",
      message: "Unknown error",
    };
    throw new ApiError(err.code, err.message, res.status);
  }

  return body.data as T;
}

export { apiFetch };
