// apps/swdnd/src/panels/CharacterSheet/Sheet/TabbedShell.tsx
import { useState, type ReactNode } from 'react';

export default function TabbedShell({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  return (
    <div>
      <div className="mt-3 flex gap-1">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setActive(t.key)}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${active === t.key ? 'ht-glow text-ht-bright' : 'ht-panel text-ht-muted'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-3">{tabs.find((t) => t.key === active)?.content}</div>
    </div>
  );
}
