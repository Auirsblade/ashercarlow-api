// apps/swdnd/src/panels/CharacterSheet/Sheet/RollToast.tsx
import { useCallback, useState } from 'react';

export interface RollLine {
  id: number;
  label: string;
  detail: string;
  total: number;
}

let rollSeq = 0;

export function useRolls() {
  const [rolls, setRolls] = useState<RollLine[]>([]);
  const pushRoll = useCallback((label: string, detail: string, total: number) => {
    const id = ++rollSeq;
    setRolls((r) => [{ id, label, detail, total }, ...r].slice(0, 5));
    setTimeout(() => setRolls((r) => r.filter((x) => x.id !== id)), 6000);
  }, []);
  return { rolls, pushRoll };
}

export default function RollToast({ rolls }: { rolls: RollLine[] }) {
  if (rolls.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-20 flex flex-col gap-2">
      {rolls.map((r) => (
        <div key={r.id} className="ht-glow ht-toast rounded px-3 py-2 font-mono text-xs text-ht-text">
          <span className="text-ht-muted">{r.label} </span>
          <b className="text-ht-bright text-base">{r.total}</b>
          <span className="text-ht-muted"> · {r.detail}</span>
        </div>
      ))}
    </div>
  );
}
