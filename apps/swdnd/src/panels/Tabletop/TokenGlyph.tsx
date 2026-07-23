// apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx
import type { GridConfig } from '../../lib/hex';
import { hexToPixel } from '../../lib/hex';
import type { TokenDto } from '../../lib/scenes';

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

export default function TokenGlyph({
  token, grid, ghost, draggable, at,
}: {
  token: TokenDto;
  grid: GridConfig;
  /** Override render position (drag preview), map px. */
  at?: { x: number; y: number };
  ghost?: boolean;
  draggable?: boolean;
}) {
  const pos = at ?? hexToPixel({ q: token.q, r: token.r }, grid);
  const radius = grid.hexSize * 0.72 * token.scale;
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      data-token-id={token.id}
      opacity={ghost ? 0.45 : 1}
      style={draggable ? { cursor: 'grab' } : undefined}
    >
      <circle r={radius} fill={token.color} fillOpacity={0.25} stroke={token.color} strokeWidth={grid.hexSize * 0.08} />
      <text
        textAnchor="middle" dominantBaseline="central"
        fill="#e6f7ff" fontFamily="monospace" fontWeight="bold"
        fontSize={radius * 0.8} style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {initials(token.name)}
      </text>
      <text
        y={radius + grid.hexSize * 0.42} textAnchor="middle"
        fill="#9adbe8" fontFamily="monospace" fontSize={grid.hexSize * 0.36}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {token.name}
      </text>
    </g>
  );
}
