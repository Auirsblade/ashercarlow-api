export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://api.ashercarlow.com";

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: "Request failed" }))) as {
      message?: string;
    };
    throw new Error(err.message ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Returns whether the current request carries a valid admin session cookie. */
export async function getAuthMe(): Promise<boolean> {
  try {
    const body = await api<{ authed?: boolean }>("/auth/me");
    return !!body.authed;
  } catch {
    return false;
  }
}
