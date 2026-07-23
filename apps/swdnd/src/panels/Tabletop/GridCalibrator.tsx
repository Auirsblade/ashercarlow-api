// apps/swdnd/src/panels/Tabletop/GridCalibrator.tsx
import type { GridConfig } from '../../lib/hex';

const Num = ({ label, value, step, min, onChange }: {
  label: string; value: number; step: number; min?: number; onChange: (v: number) => void;
}) => (
  <label className="flex items-center gap-1 text-[10px] text-ht-muted">
    {label}
    <input
      type="number" value={value} step={step} min={min}
      className="w-16 border-b border-ht-line bg-transparent px-1 text-right text-ht-bright outline-none"
      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }}
    />
  </label>
);

export default function GridCalibrator({ grid, onChange }: {
  grid: GridConfig;
  onChange: (g: GridConfig) => void;
}) {
  return (
    <div className="ht-panel flex flex-wrap items-center gap-3 p-2">
      <span className="ht-label">Grid</span>
      <button
        type="button" className="ht-step"
        onClick={() => onChange({ ...grid, orientation: grid.orientation === 'flat' ? 'pointy' : 'flat' })}
      >
        {grid.orientation === 'flat' ? '⬣ flat-top' : '⬢ pointy-top'}
      </button>
      <Num label="size" value={grid.hexSize} step={1} min={4} onChange={(hexSize) => onChange({ ...grid, hexSize })} />
      <Num label="origin x" value={grid.originX} step={2} onChange={(originX) => onChange({ ...grid, originX })} />
      <Num label="origin y" value={grid.originY} step={2} onChange={(originY) => onChange({ ...grid, originY })} />
      <Num label={`${grid.unitLabel}/hex`} value={grid.unitsPerHex} step={1} min={1} onChange={(unitsPerHex) => onChange({ ...grid, unitsPerHex })} />
    </div>
  );
}
