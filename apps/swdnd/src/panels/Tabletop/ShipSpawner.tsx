// apps/swdnd/src/panels/Tabletop/ShipSpawner.tsx — DM: drop a campaign ship onto the map.
export default function ShipSpawner({
  ships, onSpawn, onClose,
}: {
  ships: { id: string; name: string; scale: number }[];
  onSpawn: (shipId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[11px]">
      <span className="ht-label">Ships</span>
      {ships.length === 0 && (
        <span className="text-[10px] text-ht-muted">no starships in this campaign yet</span>
      )}
      {ships.map((s) => (
        <button
          key={s.id}
          type="button"
          className="ht-step"
          title={`spawn ${s.name} (${s.scale} hexes across)`}
          onClick={() => onSpawn(s.id)}
        >
          ⛴ {s.name} <span className="text-ht-muted">×{s.scale}</span>
        </button>
      ))}
      <button type="button" className="ml-auto ht-step" onClick={onClose}>✕ close</button>
    </div>
  );
}
