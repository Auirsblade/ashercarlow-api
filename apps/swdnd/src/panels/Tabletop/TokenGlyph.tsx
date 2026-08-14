// apps/swdnd/src/panels/Tabletop/TokenGlyph.tsx
import type { GridConfig } from '../../lib/hex';
import { hexToPixel } from '../../lib/hex';
import {
  BAND_FRACTION, hpArcPath, hpColor, hpFraction, RING_FONT_FRACTION, statusSegments,
} from '../../lib/rings';
import type { TokenVitals } from '../../lib/vitals';
import type { TokenDto } from '../../lib/scenes';
import { API_BASE } from '../../lib/api';
import { shipStatusNames, type ShipVitals } from '../../lib/shipVitals';

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

export default function TokenGlyph({
  token, grid, ghost, draggable, at, vitals, showHp, dimmed, active, ship, facingDeg, showRotate,
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
  /** This token's turn is currently active in the initiative order. */
  active?: boolean;
  /** Ship-bound vitals: hull drives the inner arc, shields the outer one. */
  ship?: ShipVitals | null;
  /** Bow-marker angle in screen degrees, or null for no marker. */
  facingDeg?: number | null;
  /** Show the ±60° rotation handles (selected + movable ship tokens). */
  showRotate?: boolean;
}) {
  const pos = at ?? hexToPixel({ q: token.q, r: token.r }, grid);
  const radius = grid.hexSize * 0.72 * token.scale;
  // Ships read hull/shields off the ship document; everyone else uses token/character vitals.
  const fraction = showHp
    ? (ship ? hpFraction(ship.hull, ship.maxHull) : hpFraction(vitals.hp, vitals.maxHp))
    : null;
  const shieldFraction = ship && showHp ? hpFraction(ship.shields, ship.maxShields) : null;
  // Band center sits clear of the HP arc (1.08r); band width/font follow rings.ts fractions.
  // Ship tokens carry the shield arc at 1.26r, so the band sits further out (1.62r) to keep
  // its annulus ([1.34r, 1.90r]) clear of the shield stroke ([1.21r, 1.31r] at scale 1).
  const ringR = radius * (ship ? 1.62 : 1.45);
  const band = ringR * BAND_FRACTION;
  const ringFont = ringR * RING_FONT_FRACTION;
  const segments = statusSegments(ship ? shipStatusNames(ship) : vitals.conditions, ringR);
  const rotateR = radius * 1.5;
  const handleAt = (deg: number) => ({
    x: Math.cos((deg * Math.PI) / 180) * rotateR,
    y: Math.sin((deg * Math.PI) / 180) * rotateR,
  });
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      data-token-id={token.id}
      opacity={ghost ? 0.45 : dimmed ? 0.35 : 1}
      style={draggable ? { cursor: 'grab' } : undefined}
    >
      {token.image_path ? (
        <>
          <clipPath id={`tok-clip-${token.id}`}>
            <circle r={radius * 0.96} />
          </clipPath>
          <image
            href={`${API_BASE}/swdnd/uploads/${token.image_path}?v=${token.updated_at}`}
            x={-radius} y={-radius} width={radius * 2} height={radius * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#tok-clip-${token.id})`}
          />
          {/* Faction color survives as the border ring so friend/foe reads at a glance. */}
          <circle
            r={radius} fill="none"
            stroke={token.color} strokeWidth={grid.hexSize * 0.08}
            strokeDasharray={dimmed ? '4 3' : undefined}
          />
        </>
      ) : (
        <circle
          r={radius} fill={token.color} fillOpacity={0.25}
          stroke={token.color} strokeWidth={grid.hexSize * 0.08}
          strokeDasharray={dimmed ? '4 3' : undefined}
        />
      )}
      {active && (
        <circle r={radius * 1.6} fill="none" stroke="#4dd0e1" strokeWidth={grid.hexSize * 0.06} pointerEvents="none">
          <animate attributeName="stroke-opacity" values="0.9;0.25;0.9" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      {fraction != null && (
        <path
          d={hpArcPath(radius * 1.08, fraction)}
          fill="none" stroke={hpColor(fraction)} strokeWidth={grid.hexSize * 0.09}
          strokeLinecap="round" pointerEvents="none"
        />
      )}
      {shieldFraction != null && shieldFraction > 0 && (
        // Shields ride OUTSIDE the hull arc: a depleted shield reads as a gap
        // around a still-full hull ring. (fraction === 0 renders nothing, not a pip.)
        <path
          d={hpArcPath(radius * 1.26, shieldFraction)}
          fill="none" stroke="#4dd0e1" strokeWidth={grid.hexSize * 0.07}
          strokeOpacity={0.95} strokeLinecap="round" pointerEvents="none"
        />
      )}
      {facingDeg != null && (
        <g transform={`rotate(${facingDeg})`} pointerEvents="none">
          <path
            d={`M ${radius * 1.02} 0 L ${radius * 0.66} ${-radius * 0.28} L ${radius * 0.66} ${radius * 0.28} Z`}
            fill={token.color} fillOpacity={0.95} stroke="#05070a" strokeWidth={1}
          />
        </g>
      )}
      {segments.map((s, i) => (
        <g key={s.name} pointerEvents="none">
          <path d={s.path} fill="none" stroke={s.color} strokeWidth={band} strokeOpacity={0.9} />
          {s.fits && s.textArc ? (
            <>
              <path id={`seg-${token.id}-${i}`} d={s.textArc} fill="none" />
              <text fontSize={ringFont} fill={s.textColor} fontFamily="monospace" style={{ userSelect: 'none' }}>
                <textPath href={`#seg-${token.id}-${i}`} startOffset="50%" textAnchor="middle" dominantBaseline="central">
                  {s.name}
                </textPath>
              </text>
            </>
          ) : (
            <text
              x={s.label.x} y={s.label.y} textAnchor="middle" dominantBaseline="central"
              fill={s.textColor} fontFamily="monospace" fontSize={ringFont} style={{ userSelect: 'none' }}
            >
              {s.name[0]?.toUpperCase() ?? '?'}
            </text>
          )}
        </g>
      ))}
      {/* Handles render after the (pointerEvents-none) status band so they paint on top of it
          and stay unobscured — the band annulus at 1.62r overlaps the 1.5r handle centers. */}
      {showRotate && facingDeg != null && ([
        ['ccw', facingDeg - 42, '⟲'] as const,
        ['cw', facingDeg + 42, '⟳'] as const,
      ]).map(([dir, deg, icon]) => {
        const p = handleAt(deg);
        return (
          <g key={dir} data-rotate={dir} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r={grid.hexSize * 0.3} fill="#05070a" fillOpacity={0.8} stroke="#4dd0e1" strokeWidth={1.5} />
            <text
              x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
              fill="#e6f7ff" fontFamily="monospace" fontSize={grid.hexSize * 0.34}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {icon}
            </text>
          </g>
        );
      })}
      {!token.image_path && (
        <text
          textAnchor="middle" dominantBaseline="central"
          fill="#e6f7ff" fontFamily="monospace" fontWeight="bold"
          fontSize={radius * 0.8} style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {initials(token.name)}
        </text>
      )}
      <text
        y={ringR + band / 2 + grid.hexSize * 0.4} textAnchor="middle"
        fill="#9adbe8" fontFamily="monospace" fontSize={grid.hexSize * 0.36}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {token.name}
      </text>
    </g>
  );
}
