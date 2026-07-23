// apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx
import type { GridConfig } from '../../lib/hex';
import { hexToPixel } from '../../lib/hex';
import { hpArcPath, hpColor, hpFraction, statusSegments } from '../../lib/rings';
import type { TokenVitals } from '../../lib/vitals';
import type { TokenDto } from '../../lib/scenes';

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

export default function TokenGlyph({
  token, grid, ghost, draggable, at, vitals, showHp, dimmed,
}: {
  token: TokenDto;
  grid: GridConfig;
  /** Override render position (drag preview), map px. */
  at?: { x: number; y: number };
  ghost?: boolean;
  draggable?: boolean;
  vitals: TokenVitals;
  showHp: boolean;
  /** DM view of a hidden token. */
  dimmed?: boolean;
}) {
  const pos = at ?? hexToPixel({ q: token.q, r: token.r }, grid);
  const radius = grid.hexSize * 0.72 * token.scale;
  const fraction = showHp ? hpFraction(vitals.hp, vitals.maxHp) : null;
  const segments = statusSegments(vitals.conditions, radius * 1.28);
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      data-token-id={token.id}
      opacity={ghost ? 0.45 : dimmed ? 0.35 : 1}
      style={draggable ? { cursor: 'grab' } : undefined}
    >
      <circle
        r={radius} fill={token.color} fillOpacity={0.25}
        stroke={token.color} strokeWidth={grid.hexSize * 0.08}
        strokeDasharray={dimmed ? '4 3' : undefined}
      />
      {fraction != null && (
        <path
          d={hpArcPath(radius * 1.08, fraction)}
          fill="none" stroke={hpColor(fraction)} strokeWidth={grid.hexSize * 0.09}
          strokeLinecap="round" pointerEvents="none"
        />
      )}
      {segments.map((s) => (
        <g key={s.name} pointerEvents="none">
          <path d={s.path} fill="none" stroke={s.color} strokeWidth={grid.hexSize * 0.07} strokeLinecap="round" />
          <text
            x={s.label.x} y={s.label.y} textAnchor="middle" dominantBaseline="central"
            fill={s.color} fontFamily="monospace" fontSize={grid.hexSize * 0.3}
            style={{ userSelect: 'none' }}
          >
            {s.name}
          </text>
        </g>
      ))}
      <text
        textAnchor="middle" dominantBaseline="central"
        fill="#e6f7ff" fontFamily="monospace" fontWeight="bold"
        fontSize={radius * 0.8} style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {initials(token.name)}
      </text>
      <text
        y={radius * 1.28 + grid.hexSize * 0.5} textAnchor="middle"
        fill="#9adbe8" fontFamily="monospace" fontSize={grid.hexSize * 0.36}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {token.name}
      </text>
    </g>
  );
}
