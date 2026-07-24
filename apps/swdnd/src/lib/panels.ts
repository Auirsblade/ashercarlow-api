// apps/swdnd/src/lib/panels.ts — pure panel descriptors + split navigation model.
// The whole alt-click/split rule table lives in navigateFrom; components stay dumb.

export type PanelKind = 'sheet' | 'map' | 'dm';
export interface Panel { kind: PanelKind; id: string }
export interface SplitCtx { left: Panel; right: Panel; side: 'left' | 'right' }

const KINDS: readonly string[] = ['sheet', 'map', 'dm'];

/** `kind:id` → Panel, or null on anything malformed. Ids may contain ':' but never '/'. */
export function parsePanel(s: string): Panel | null {
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const kind = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!KINDS.includes(kind) || !id || id.includes('/')) return null;
  return { kind: kind as PanelKind, id };
}

export const formatPanel = (p: Panel): string => `${p.kind}:${p.id}`;

/** The panel's full-screen route. */
export function panelPath(p: Panel): string {
  if (p.kind === 'sheet') return `/sheet/${p.id}`;
  if (p.kind === 'map') return `/map/${p.id}`;
  return `/dm/${p.id}`;
}

export const splitPath = (left: Panel, right: Panel): string =>
  `/split/${formatPanel(left)}/${formatPanel(right)}`;

export const samePanel = (a: Panel, b: Panel): boolean => a.kind === b.kind && a.id === b.id;

/**
 * The navigation rule table (query strings are the caller's job):
 * - full screen: alt + a known current panel → split (current left, target right); else target full screen
 * - in a split: plain replaces your own side, alt replaces the other side
 * - a move that would show the same panel on both sides collapses to it full screen
 */
export function navigateFrom(
  ctx: SplitCtx | null,
  current: Panel | null,
  target: Panel,
  alt: boolean,
): string {
  if (!ctx) {
    if (alt && current && !samePanel(current, target)) return splitPath(current, target);
    return panelPath(target);
  }
  const replaceLeft = alt ? ctx.side === 'right' : ctx.side === 'left';
  const nextLeft = replaceLeft ? target : ctx.left;
  const nextRight = replaceLeft ? ctx.right : target;
  if (samePanel(nextLeft, nextRight)) return panelPath(target);
  return splitPath(nextLeft, nextRight);
}
