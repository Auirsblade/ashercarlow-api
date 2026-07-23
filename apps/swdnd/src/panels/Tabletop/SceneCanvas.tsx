// apps/swdnd/src/panels/Tabletop/SceneCanvas.tsx
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { API_BASE } from '../../lib/api';
import { hexBlast, hexCorners, hexToPixel, pixelToHex, type Hex } from '../../lib/hex';
import { clientToMap, fitViewBox, panViewBox, zoomViewBox, type ViewBox } from '../../lib/viewBox';
import type { SceneDto, TokenDto } from '../../lib/scenes';
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

export default function SceneCanvas({ scene, tokens, dragGhosts, canMove, onMove, onDragFrame, calibrating }: Props) {
  const g = scene.grid_json;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [vb, setVb] = useState<ViewBox>(() => fitViewBox(scene.image_w ?? 1200, scene.image_h ?? 800));
  const [drag, setDrag] = useState<{ tokenId: string; x: number; y: number } | null>(null);
  const pan = useRef<{ startX: number; startY: number; vb: ViewBox } | null>(null);

  const hexes = useMemo(() => gridHexes(scene), [scene]);
  const mapPoint = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return clientToMap(vb, rect, e.clientX, e.clientY);
  };

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setVb((cur) => zoomViewBox(cur, mapPoint(e), e.deltaY > 0 ? 1.12 : 1 / 1.12));
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const tokenEl = (e.target as Element).closest('[data-token-id]');
    const tokenId = tokenEl?.getAttribute('data-token-id');
    const token = tokens.find((t) => t.id === tokenId);
    if (token && canMove(token)) {
      const p = mapPoint(e);
      setDrag({ tokenId: token.id, x: p.x, y: p.y });
    } else {
      pan.current = { startX: e.clientX, startY: e.clientY, vb };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag) {
      const p = mapPoint(e);
      setDrag({ ...drag, x: p.x, y: p.y });
      onDragFrame(drag.tokenId, p.x, p.y, false);
    } else if (pan.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const dx = ((pan.current.startX - e.clientX) / rect.width) * pan.current.vb.w;
      const dy = ((pan.current.startY - e.clientY) / rect.height) * pan.current.vb.h;
      setVb(panViewBox(pan.current.vb, dx, dy));
    }
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag) {
      const p = mapPoint(e);
      const hex = pixelToHex(p.x, p.y, g);
      onDragFrame(drag.tokenId, p.x, p.y, true);
      onMove(drag.tokenId, hex.q, hex.r);
      setDrag(null);
    }
    pan.current = null;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      className="h-full w-full touch-none select-none"
      onWheel={onWheel}
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
            />
          );
        })}
      </g>
    </svg>
  );
}
