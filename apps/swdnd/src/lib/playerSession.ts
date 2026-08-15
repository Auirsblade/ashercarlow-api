// apps/swdnd/src/lib/playerSession.ts — the remembered player code.
// The ONLY module that touches this key. Friends-trust model: the code is an
// unguessable invite UUID, not a password; localStorage is fine. Every helper
// swallows storage errors (private mode / disabled storage → behave as absent).
const KEY = 'swdnd.playerToken';

export function getStoredToken(): string | null {
  try {
    const v = globalThis.localStorage.getItem(KEY);
    const trimmed = v?.trim() ?? '';
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  const trimmed = token.trim();
  if (trimmed === '') return;
  try {
    globalThis.localStorage.setItem(KEY, trimmed);
  } catch {
    /* storage unavailable — the form still works per-visit */
  }
}

export function clearStoredToken(): void {
  try {
    globalThis.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
