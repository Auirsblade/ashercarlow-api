import { createSignal } from "solid-js";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://api.ashercarlow.com";

const TOKEN_KEY = "ashercarlow_token";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  setAuthSignal(true);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  setAuthSignal(false);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export const [authSignal, setAuthSignal] = createSignal(isAuthenticated());

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<T> {
  const { timeout, ...fetchOptions } = options;
  const token = getToken();

  let signal = fetchOptions.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (timeout && !signal) {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...fetchOptions.headers,
      },
    });
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw e;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || err.error || "Request failed");
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return res.json();
}
