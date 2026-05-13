import { createSignal } from "solid-js";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://api.ashercarlow.com";

export const [authSignal, setAuthSignal] = createSignal(false);

/** Hits /auth/me and updates authSignal. Returns the new value. */
export async function refreshAuth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
    if (!res.ok) {
      setAuthSignal(false);
      return false;
    }
    const body = (await res.json()) as { authed?: boolean };
    const authed = !!body.authed;
    setAuthSignal(authed);
    return authed;
  } catch {
    setAuthSignal(false);
    return false;
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  setAuthSignal(false);
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<T> {
  const { timeout, ...fetchOptions } = options;

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
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
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
    setAuthSignal(false);
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
