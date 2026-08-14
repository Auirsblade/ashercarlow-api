// apps/swdnd/src/panels/Tabletop/ShipSpawner.tsx — DM: drop a campaign ship onto the map.
export default function ShipSpawner({
  ships, onSpawn, onClose,
}: {
  ships: {
    list: { id: string; name: string; scale: number }[];
    loading: boolean;
    spawning: Set<string>;
  };
  onSpawn: (shipId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[11px]">
      <span className="ht-label">Ships</span>
      {ships.list.length === 0 && (
        <span className="text-[10px] text-ht-muted">
          {ships.loading ? 'loading ships…' : 'no starships in this campaign yet'}
        </span>
      )}
      {ships.list.map((s) => (
        <button
          key={s.id}
          type="button"
          className="ht-step"
          title={`spawn ${s.name} (${s.scale} hexes across)`}
          disabled={ships.spawning.has(s.id)}
          onClick={() => onSpawn(s.id)}
        >
          ⛴ {s.name} <span className="text-ht-muted">×{s.scale}</span>
        </button>
      ))}
      <button type="button" className="ml-auto ht-step" onClick={onClose}>✕ close</button>
    </div>
  );
}
