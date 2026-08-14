// apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { API_BASE } from '../../lib/api';
import { gridUnits, hexBlast, hexCorners, hexDistance, hexesToUnits, hexLine, hexToPixel, pixelToHex, type Hex } from '../../lib/hex';
import { clientDeltaToMap, clientToMap, fitViewBox, panViewBox, zoomViewBox, type ViewBox } from '../../lib/viewBox';
import type { SceneDto, TemplateDto, TokenDto } from '../../lib/scenes';
import { applyFogPatch, brushKeys, fogActive, toFogSet } from '../../lib/fog';
import { tokenVisibility, showHpRing, isOwnToken } from '../../lib/visibility';
import { tokenVitals, type Vitals } from '../../lib/vitals';
import { dirFromPoint, templateHexes } from '../../lib/templates';
import { facingAngle, rotateFacing } from '../../lib/shipTokens';
import { tokenShipVitals, type ShipVitals } from '../../lib/shipVitals';
import TokenGlyph from './TokenGlyph';

interface Props {
  scene: SceneDto;
  tokens: TokenDto[];
  dragGhosts: Record<string, { x: number; y: number }>;
  canMove: (t: TokenDto) => boolean;
  onMove: (tokenId: string, q: number, r: number) => void;
  onDragFrame: (tokenId: string, x: number, y: number, done: boolean) => void;
  /** DM calibration preview: when true the grid draws boldly. */
  calibrating?: boolean;
  isDm: boolean;
  ownCharacterIds: Set<string>;
  vitals: Record<string, Vitals>;
  /** null = fog tool off; otherwise the active brush. */
  fogBrush: { mode: 'reveal' | 'hide'; radius: number } | null;
  onFogCommit: (reveal: string[], hide: string[]) => void;
  /** DM tap on a token (no drag) selects it for editing. */
  onSelectToken: (tokenId: string | null) => void;
  /** Active interaction tool. 'move' = phase-1/2 behavior. */
  mode: 'move' | 'ruler' | 'ping' | 'blast' | 'cone' | 'line';
  templateSize: number;
  templates: TemplateDto[];
  pings: { id: string; x: number; y: number }[];
  rulers: Record<string, { a: Hex; b: Hex }>;
  onPing: (x: number, y: number) => void;
  onRulerFrame: (a: Hex, b: Hex, done: boolean) => void;
  onCreateTemplate: (body: Record<string, unknown>) => void;
  /** Tap on a template's origin handle selects it (editor opens above the map). */
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string | null) => void;
  /** Drag of a template's origin handle, reported as a hex delta. */
  onMoveTemplate: (id: string, dq: number, dr: number) => void;
  /** Right-click on a token (client coords, for a floating menu). */
  onTokenContextMenu?: (tokenId: string, clientX: number, clientY: number) => void;
  /** Ship-bound vitals by ship id (hull/shields/conditions rings). */
  shipVitals: Record<string, ShipVitals>;
  /** Ships this viewer crews — own-token fog exemption. */
  ownShipIds: Set<string>;
  /** The token whose editor is open; ship tokens then show rotation handles. */
  selectedTokenId: string | null;
  /** A ±60° rotation step was requested on a ship token. */
  onRotate: (tokenId: string, facing: number) => void;
  /** Tokens taking the current initiative turn (a ship slot pulses with its crew). */
  activeTokenIds: Set<string>;
}

/** Grid polygons covering the image area (plus one hex of margin). */
function gridHexes(scene: SceneDto): Hex[] {
  const g = scene.grid_json;
  const w = scene.image_w ?? 1200;
  const h = scene.image_h ?? 800;
  const center = pixelToHex(w / 2, h / 2, g);
  const radius = Math.ceil(Math.max(w, h) / (g.hexSize * 1.5)) + 1;
  return hexBlast(center, radius).filter((hex) => {
    const p = hexToPixel(hex, g);
    return p.x > -g.hexSize && p.x < w + g.hexSize && p.y > -g.hexSize && p.y < h + g.hexSize;
  });
}

export default function SceneCanvas({
  scene, tokens, dragGhosts, canMove, onMove, onDragFrame, calibrating,
  isDm, ownCharacterIds, vitals, fogBrush, onFogCommit, onSelectToken,
  mode, templateSize, templates, pings, rulers,
  onPing, onRulerFrame, onCreateTemplate, selectedTemplateId, onSelectTemplate, onMoveTemplate,
  onTokenContextMenu, shipVitals, ownShipIds, selectedTokenId, onRotate, activeTokenIds,
}: Props) {
  const g = scene.grid_json;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [vb, setVb] = useState<ViewBox>(() => fitViewBox(scene.image_w ?? 1200, scene.image_h ?? 800));
  const [drag, setDrag] = useState<{
    tokenId: string; x: number; y: number; startClientX: number; startClientY: number; startHex: Hex;
  } | null>(null);
  const pan = useRef<{
    startX: number; startY: number; vb: ViewBox; startClientX: number; startClientY: number;
  } | null>(null);
  const [tplMove, setTplMove] = useState<{
    id: string; start: Hex; cur: Hex; startClientX: number; startClientY: number;
  } | null>(null);
  const [fogStroke, setFogStroke] = useState<Set<string> | null>(null);
  const fogStrokeRef = useRef<Set<string>>(new Set());
  const [rulerDrag, setRulerDrag] = useState<{ a: Hex; b: Hex } | null>(null);
  const [tplDrag, setTplDrag] = useState<{
    kind: 'cone' | 'line'; origin: Hex; x: number; y: number; startClientX: number; startClientY: number;
  } | null>(null);

  const hexes = useMemo(() => gridHexes(scene), [scene]);
  const mapPoint = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return clientToMap(rect, vb, e.clientX, e.clientY);
  };

  // Native (non-passive) wheel listener: React's onWheel is passive, so
  // preventDefault() there is a no-op and the surrounding pane scrolls too.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setVb((cur) => zoomViewBox(cur, clientToMap(rect, cur, e.clientX, e.clientY), e.deltaY > 0 ? 1.12 : 1 / 1.12));
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return; // right-click is the context menu, never a drag/pan
    // Capture is a nicety (keeps fast drags delivered); a synthetic/stale
    // pointer id throws InvalidPointerId and must not abort the gesture.
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    // Rotation handles live inside the token group: consume the gesture before
    // any drag/pan branch can claim it.
    const rotEl = (e.target as Element).closest('[data-rotate]');
    if (rotEl) {
      const rotId = rotEl.closest('[data-token-id]')?.getAttribute('data-token-id');
      const rotTok = tokens.find((t) => t.id === rotId);
      if (rotTok && canMove(rotTok)) {
        onRotate(rotTok.id, rotateFacing(rotTok.facing, rotEl.getAttribute('data-rotate') === 'cw' ? 1 : -1));
      }
      return;
    }
    if (fogBrush) {
      const p = mapPoint(e);
      const keys = brushKeys(pixelToHex(p.x, p.y, g), fogBrush.radius);
      fogStrokeRef.current = new Set(keys);
      setFogStroke(new Set(keys));
      return; // fog tool swallows the gesture — no drag, no pan
    }
    if (mode === 'ruler') {
      const p = mapPoint(e);
      const a = pixelToHex(p.x, p.y, g);
      setRulerDrag({ a, b: a });
      return;
    }
    if (mode === 'cone' || mode === 'line') {
      const p = mapPoint(e);
      setTplDrag({
        kind: mode, origin: pixelToHex(p.x, p.y, g), x: p.x, y: p.y,
        startClientX: e.clientX, startClientY: e.clientY,
      });
      return;
    }
    const tokenEl = (e.target as Element).closest('[data-token-id]');
    const tokenId = tokenEl?.getAttribute('data-token-id');
    const token = tokens.find((t) => t.id === tokenId);
    if (token && canMove(token)) {
      const p = mapPoint(e);
      setDrag({
        tokenId: token.id, x: p.x, y: p.y,
        startClientX: e.clientX, startClientY: e.clientY,
        startHex: { q: token.q, r: token.r },
      });
    } else {
      const tplId = (e.target as Element).closest('[data-template-id]')?.getAttribute('data-template-id');
      if (tplId) {
        const p = mapPoint(e);
        const h = pixelToHex(p.x, p.y, g);
        setTplMove({ id: tplId, start: h, cur: h, startClientX: e.clientX, startClientY: e.clientY });
      } else {
        pan.current = {
          startX: e.clientX, startY: e.clientY, vb, startClientX: e.clientX, startClientY: e.clientY,
        };
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (fogBrush && fogStroke) {
      const p = mapPoint(e);
      let added = false;
      for (const k of brushKeys(pixelToHex(p.x, p.y, g), fogBrush.radius)) {
        if (!fogStrokeRef.current.has(k)) {
          fogStrokeRef.current.add(k);
          added = true;
        }
      }
      // Only re-render when the stroke actually grew — most pointermoves
      // during a stroke land on hexes already painted.
      if (added) setFogStroke(new Set(fogStrokeRef.current));
      return;
    }
    if (rulerDrag) {
      const p = mapPoint(e);
      const b = pixelToHex(p.x, p.y, g);
      if (b.q !== rulerDrag.b.q || b.r !== rulerDrag.b.r) {
        setRulerDrag({ a: rulerDrag.a, b });
        onRulerFrame(rulerDrag.a, b, false);
      }
      return;
    }
    if (tplDrag) {
      const p = mapPoint(e);
      setTplDrag({ ...tplDrag, x: p.x, y: p.y });
      return;
    }
    if (tplMove) {
      const p = mapPoint(e);
      const h = pixelToHex(p.x, p.y, g);
      if (h.q !== tplMove.cur.q || h.r !== tplMove.cur.r) setTplMove({ ...tplMove, cur: h });
      return;
    }
    if (drag) {
      const p = mapPoint(e);
      setDrag({ ...drag, x: p.x, y: p.y });
      onDragFrame(drag.tokenId, p.x, p.y, false);
    } else if (pan.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const { dx, dy } = clientDeltaToMap(
        rect, pan.current.vb, pan.current.startX - e.clientX, pan.current.startY - e.clientY,
      );
      setVb(panViewBox(pan.current.vb, dx, dy));
    }
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (fogBrush && fogStroke) {
      const keys = [...fogStrokeRef.current];
      onFogCommit(fogBrush.mode === 'reveal' ? keys : [], fogBrush.mode === 'hide' ? keys : []);
      fogStrokeRef.current = new Set();
      setFogStroke(null);
      return;
    }
    if (rulerDrag) {
      onRulerFrame(rulerDrag.a, rulerDrag.b, true);
      setRulerDrag(null);
      return;
    }
    if (tplDrag) {
      const p = mapPoint(e);
      const tplMoved = Math.hypot(e.clientX - tplDrag.startClientX, e.clientY - tplDrag.startClientY) > 4;
      if (tplDrag.kind === 'cone') {
        // A stationary click has no meaningful direction — dirFromPoint would
        // fall back to dir 0, which would persist a bogus dir-0 cone at every
        // tap. Require the same 4px movement threshold used for token drags.
        if (tplMoved) {
          const dir = dirFromPoint(tplDrag.origin, p.x, p.y, g);
          onCreateTemplate({ kind: 'cone', q: tplDrag.origin.q, r: tplDrag.origin.r, dir, size: templateSize });
        }
      } else {
        const end = pixelToHex(p.x, p.y, g);
        if (end.q !== tplDrag.origin.q || end.r !== tplDrag.origin.r) {
          onCreateTemplate({ kind: 'line', q: tplDrag.origin.q, r: tplDrag.origin.r, q2: end.q, r2: end.r });
        }
      }
      setTplDrag(null);
      return;
    }
    if (tplMove) {
      const moved = Math.hypot(e.clientX - tplMove.startClientX, e.clientY - tplMove.startClientY) > 4;
      const dq = tplMove.cur.q - tplMove.start.q;
      const dr = tplMove.cur.r - tplMove.start.r;
      if (moved && (dq !== 0 || dr !== 0)) onMoveTemplate(tplMove.id, dq, dr);
      else if (!moved) onSelectTemplate(tplMove.id);
      setTplMove(null);
      return;
    }
    if (drag) {
      const p = mapPoint(e);
      const moved = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > 4;
      const hex = pixelToHex(p.x, p.y, g);
      onDragFrame(drag.tokenId, p.x, p.y, true);
      if (!moved) {
        const t = tokens.find((x) => x.id === drag.tokenId);
        const own = !!t && isOwnToken(t, { ownCharacterIds, ownShipIds });
        if (isDm || own) onSelectToken(drag.tokenId);
      } else if (hex.q !== drag.startHex.q || hex.r !== drag.startHex.r) {
        onMove(drag.tokenId, hex.q, hex.r);
      }
      setDrag(null);
    } else if (pan.current) {
      const movedPan = Math.hypot(e.clientX - pan.current.startClientX, e.clientY - pan.current.startClientY) > 4;
      if (!movedPan) {
        const p = mapPoint(e);
        if (mode === 'ping') {
          onPing(p.x, p.y);
        } else if (mode === 'blast') {
          const hex = pixelToHex(p.x, p.y, g);
          onCreateTemplate({ kind: 'blast', q: hex.q, r: hex.r, size: templateSize });
        } else {
          onSelectToken(null); // players deselect their own-token panel the same way
          onSelectTemplate(null);
        }
      }
    }
    pan.current = null;
  };

  // The rendered fog merges the committed set with the in-flight stroke so
  // painting feels instant.
  const effectiveRevealed = useMemo(() => {
    if (!fogStroke || !fogBrush) return scene.fog_json;
    return applyFogPatch(scene.fog_json, {
      reveal: fogBrush.mode === 'reveal' ? [...fogStroke] : [],
      hide: fogBrush.mode === 'hide' ? [...fogStroke] : [],
    });
  }, [scene.fog_json, fogStroke, fogBrush]);

  const renderToken = (t: TokenDto, dimmed: boolean) => {
    const localDrag = drag?.tokenId === t.id ? { x: drag.x, y: drag.y } : undefined;
    const remoteGhost = !localDrag && dragGhosts[t.id] ? dragGhosts[t.id] : undefined;
    const ship = tokenShipVitals(t, shipVitals);
    return (
      <TokenGlyph
        key={t.id}
        token={t}
        grid={g}
        at={localDrag ?? remoteGhost}
        ghost={!!remoteGhost}
        draggable={canMove(t)}
        vitals={tokenVitals(t, vitals)}
        showHp={showHpRing(t, isDm)}
        dimmed={dimmed}
        active={activeTokenIds.has(t.id)}
        ship={ship}
        facingDeg={t.ship_id ? facingAngle(t.facing, g) : null}
        showRotate={!!t.ship_id && t.id === selectedTokenId && canMove(t)}
      />
    );
  };

  const fogOn = fogActive(effectiveRevealed);

  return (
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      className="h-full w-full touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onContextMenu={(e) => {
        e.preventDefault(); // the map owns right-click; no browser menu
        const id = (e.target as Element).closest('[data-token-id]')?.getAttribute('data-token-id');
        if (id) onTokenContextMenu?.(id, e.clientX, e.clientY);
      }}
    >
      {scene.image_path && (
        <image
          // Cache-buster: /swdnd/uploads/* is served with an immutable cache
          // header, but re-uploads keep the same filename — appending
          // updated_at forces the browser to refetch when the scene changes.
          href={`${API_BASE}/swdnd/uploads/${scene.image_path}?v=${encodeURIComponent(scene.updated_at)}`}
          x={0} y={0}
          width={scene.image_w ?? undefined} height={scene.image_h ?? undefined}
          preserveAspectRatio="none"
        />
      )}
      <g pointerEvents="none">
        {hexes.map((hex) => (
          <polygon
            key={`${hex.q},${hex.r}`}
            points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#4dd0e1"
            strokeOpacity={calibrating ? 0.75 : 0.18}
            strokeWidth={calibrating ? 1.5 : 1}
          />
        ))}
      </g>
      <g>
        {templates.map((t) => {
          // In-flight handle drag: preview the template at its tentative spot.
          const mv = tplMove?.id === t.id ? tplMove : null;
          const dq = mv ? mv.cur.q - mv.start.q : 0;
          const dr = mv ? mv.cur.r - mv.start.r : 0;
          const shown = dq !== 0 || dr !== 0
            ? {
                ...t, q: t.q + dq, r: t.r + dr,
                q2: t.q2 != null ? t.q2 + dq : t.q2,
                r2: t.r2 != null ? t.r2 + dr : t.r2,
              }
            : t;
          const cells = templateHexes(shown);
          const o = hexToPixel({ q: shown.q, r: shown.r }, g);
          const isSelected = t.id === selectedTemplateId;
          return (
            <g key={t.id}>
              <g pointerEvents="none">
                {cells.map((hex) => (
                  <polygon
                    key={`${t.id}:${hex.q},${hex.r}`}
                    points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={t.color} fillOpacity={0.22}
                    stroke={t.color} strokeOpacity={0.6} strokeWidth={1}
                  />
                ))}
              </g>
              {/* origin marker: drag moves the template, tap opens its editor */}
              <circle
                data-template-id={t.id}
                cx={o.x} cy={o.y} r={g.hexSize * 0.22}
                fill={t.color} fillOpacity={0.9}
                stroke={isSelected ? '#f5fbff' : '#05070a'} strokeWidth={isSelected ? 2 : 1}
                style={{ cursor: 'grab' }}
              />
            </g>
          );
        })}
        {/* in-flight cone/line preview, dashed */}
        {tplDrag && (() => {
          const preview: TemplateDto = {
            id: '__preview', scene_id: scene.id, kind: tplDrag.kind,
            q: tplDrag.origin.q, r: tplDrag.origin.r,
            dir: tplDrag.kind === 'cone' ? dirFromPoint(tplDrag.origin, tplDrag.x, tplDrag.y, g) : 0,
            size: templateSize,
            q2: tplDrag.kind === 'line' ? pixelToHex(tplDrag.x, tplDrag.y, g).q : null,
            r2: tplDrag.kind === 'line' ? pixelToHex(tplDrag.x, tplDrag.y, g).r : null,
            color: '#c792ea', created_at: '',
          };
          return (
            <g pointerEvents="none">
              {templateHexes(preview).map((hex) => (
                <polygon
                  key={`pv:${hex.q},${hex.r}`}
                  points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="#c792ea" fillOpacity={0.12}
                  stroke="#c792ea" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="4 3"
                />
              ))}
            </g>
          );
        })()}
      </g>
      <g>
        {tokens.map((t) => {
          // Own tokens render a second time in the above-fog group below (so
          // players always see their own token at full strength, never
          // dimmed by fog over their own hex); skip them here or they'd
          // stack two semi-transparent copies and read as more saturated.
          const ownToken = isOwnToken(t, { ownCharacterIds, ownShipIds });
          if (!isDm && fogOn && ownToken) return null;
          const vis = tokenVisibility(t, { isDm, revealed: effectiveRevealed, ownCharacterIds, ownShipIds });
          if (!vis.visible) return null;
          return renderToken(t, vis.dimmed);
        })}
      </g>
      {fogOn && (() => {
        const revealedSet = toFogSet(effectiveRevealed);
        const unrevealed = hexes.filter((hex) => !revealedSet.has(`${hex.q},${hex.r}`));
        return (
          <g pointerEvents="none">
            {unrevealed.map((hex) => (
              <polygon
                key={`fog-${hex.q},${hex.r}`}
                points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
                fill="#05070a"
                fillOpacity={isDm ? 0.4 : 1}
                stroke="#05070a"
                strokeOpacity={isDm ? 0.4 : 1}
                strokeWidth={1.5}
              />
            ))}
          </g>
        );
      })()}
      {!isDm && fogOn && (
        // This is now the ONLY copy of the player's own token (excluded from
        // the main group above), so it must stay pointer-interactive — no
        // pointerEvents="none" here — or drag/tap targeting via
        // closest('[data-token-id]') in onPointerDown would miss it.
        <g>
          {tokens
            .filter((t) => isOwnToken(t, { ownCharacterIds, ownShipIds }))
            .map((t) => {
              const vis = tokenVisibility(t, { isDm, revealed: effectiveRevealed, ownCharacterIds, ownShipIds });
              if (!vis.visible) return null;
              return renderToken(t, vis.dimmed);
            })}
        </g>
      )}
      <g pointerEvents="none">
        {/* rulers: local drag + remote peers */}
        {[
          ...(rulerDrag ? [{ key: '__local', ...rulerDrag }] : []),
          ...Object.entries(rulers).map(([peer, rl]) => ({ key: peer, ...rl })),
        ].map(({ key, a, b }) => {
          const pa = hexToPixel(a, g);
          const pb = hexToPixel(b, g);
          const cells = hexLine(a, b);
          const units = gridUnits(g);
          const dist = hexesToUnits(hexDistance(a, b), g);
          return (
            <g key={`ruler-${key}`}>
              {cells.map((hex) => (
                <polygon
                  key={`rl:${key}:${hex.q},${hex.r}`}
                  points={hexCorners(hex, g).map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="#4dd0e1" fillOpacity={0.15} stroke="#4dd0e1" strokeOpacity={0.5} strokeWidth={1}
                />
              ))}
              <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#4dd0e1" strokeWidth={1.5} strokeDasharray="6 4" />
              <text
                x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - g.hexSize * 0.4}
                textAnchor="middle" fill="#e6f7ff" fontFamily="monospace" fontSize={g.hexSize * 0.45}
                stroke="#05070a" strokeWidth={3} paintOrder="stroke"
              >
                {dist} {units.label}
              </text>
            </g>
          );
        })}
        {/* pings: expanding double-pulse */}
        {pings.map((p) => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={g.hexSize * 0.3} fill="none" stroke="#ffcb6b" strokeWidth={2}>
              <animate attributeName="r" from={g.hexSize * 0.3} to={g.hexSize * 2.2} dur="1s" repeatCount="2" />
              <animate attributeName="stroke-opacity" from="1" to="0" dur="1s" repeatCount="2" />
            </circle>
            <circle cx={p.x} cy={p.y} r={g.hexSize * 0.16} fill="#ffcb6b" />
          </g>
        ))}
      </g>
    </svg>
  );
}
