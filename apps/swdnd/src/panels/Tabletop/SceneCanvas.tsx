// apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { API_BASE } from '../../lib/api';
import { hexBlast, hexCorners, hexToPixel, pixelToHex, type Hex } from '../../lib/hex';
import { clientDeltaToMap, clientToMap, fitViewBox, panViewBox, zoomViewBox, type ViewBox } from '../../lib/viewBox';
import type { SceneDto, TokenDto } from '../../lib/scenes';
import { applyFogPatch, brushKeys, fogActive, toFogSet } from '../../lib/fog';
import { tokenVisibility, showHpRing } from '../../lib/visibility';
import { tokenVitals, type Vitals } from '../../lib/vitals';
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
}: Props) {
  const g = scene.grid_json;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [vb, setVb] = useState<ViewBox>(() => fitViewBox(scene.image_w ?? 1200, scene.image_h ?? 800));
  const [drag, setDrag] = useState<{
    tokenId: string; x: number; y: number; startClientX: number; startClientY: number; startHex: Hex;
  } | null>(null);
  const pan = useRef<{ startX: number; startY: number; vb: ViewBox; startClientX: number; startClientY: number } | null>(null);
  const [fogStroke, setFogStroke] = useState<Set<string> | null>(null);
  const fogStrokeRef = useRef<Set<string>>(new Set());

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
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (fogBrush) {
      const p = mapPoint(e);
      const keys = brushKeys(pixelToHex(p.x, p.y, g), fogBrush.radius);
      fogStrokeRef.current = new Set(keys);
      setFogStroke(new Set(keys));
      return; // fog tool swallows the gesture — no drag, no pan
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
      pan.current = { startX: e.clientX, startY: e.clientY, vb, startClientX: e.clientX, startClientY: e.clientY };
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
    if (drag) {
      const p = mapPoint(e);
      const moved = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > 4;
      const hex = pixelToHex(p.x, p.y, g);
      onDragFrame(drag.tokenId, p.x, p.y, true);
      if (!moved) {
        if (isDm) onSelectToken(drag.tokenId);
      } else if (hex.q !== drag.startHex.q || hex.r !== drag.startHex.r) {
        onMove(drag.tokenId, hex.q, hex.r);
      }
      setDrag(null);
    } else if (pan.current) {
      const movedPan = Math.hypot(e.clientX - pan.current.startClientX, e.clientY - pan.current.startClientY) > 4;
      if (!movedPan && isDm) onSelectToken(null);
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
        {tokens.map((t) => {
          // Own tokens render a second time in the above-fog group below (so
          // players always see their own token at full strength, never
          // dimmed by fog over their own hex); skip them here or they'd
          // stack two semi-transparent copies and read as more saturated.
          const ownToken = !!t.character_id && ownCharacterIds.has(t.character_id);
          if (!isDm && fogOn && ownToken) return null;
          const vis = tokenVisibility(t, { isDm, revealed: effectiveRevealed, ownCharacterIds });
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
            .filter((t) => !!t.character_id && ownCharacterIds.has(t.character_id))
            .map((t) => {
              const vis = tokenVisibility(t, { isDm, revealed: effectiveRevealed, ownCharacterIds });
              if (!vis.visible) return null;
              return renderToken(t, vis.dimmed);
            })}
        </g>
      )}
    </svg>
  );
}
