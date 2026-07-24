// apps/swdnd/src/components/split.tsx — SplitContext + the split-aware nav link.
// Screens use PanelLink for panel-to-panel navigation and stay split-agnostic.
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { navigateFrom, panelPath, type Panel, type SplitCtx } from '../lib/panels';

export const SplitContext = createContext<SplitCtx | null>(null);
export const useSplit = (): SplitCtx | null => useContext(SplitContext);

/**
 * A nav link between panel screens. Plain click follows the navigation model
 * (full-screen nav, or contained replace inside a split); alt-click opens the
 * target beside `current` / replaces the split's other side. Modified clicks
 * (ctrl/cmd/shift/middle) keep browser behavior via the real href.
 */
export function PanelLink({
  to, current, className, children, title,
}: {
  to: Panel;
  /** The panel the link lives on; enables full-screen alt-click. Omit on non-panel screens. */
  current?: Panel;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const ctx = useSplit();
  const navigate = useNavigate();
  const { search } = useLocation();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); // also stops alt-click's browser default (download) on some platforms
    navigate(navigateFrom(ctx, current ?? null, to, e.altKey) + search);
  };
  return (
    <Link to={panelPath(to) + search} className={className} title={title} onClick={onClick}>
      {children}
    </Link>
  );
}
