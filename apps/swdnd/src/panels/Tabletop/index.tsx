// apps/swdnd/src/panels/Tabletop/index.tsx
import { useTabletop } from '../../hooks/useTabletop';
import SceneCanvas from './SceneCanvas';

export default function Tabletop({ campaignId }: { campaignId: string }) {
  const t = useTabletop(campaignId);

  if (t.loading) return <div className="ht-screen min-h-full p-6 font-mono text-ht-muted">Loading map…</div>;

  return (
    <div className="@container ht-screen flex h-screen min-h-full flex-col font-mono text-ht-text">
      {t.error && (
        <div className="m-2 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 text-[11px] text-red-300">
          ⚠ {t.error}
        </div>
      )}
      <div className="ht-glow m-2 flex flex-wrap items-center gap-3 rounded-md p-2 text-[11px]">
        <span className="ht-name font-bold">{t.scene?.name ?? 'No active scene'}</span>
        {t.scene && (
          <span className="text-[10px] text-ht-muted">
            {t.scene.grid_json.unitsPerHex} {t.scene.grid_json.unitLabel}/hex · {t.tokens.length} tokens
          </span>
        )}
        {/* DM toolbar buttons land in Task 11 */}
      </div>
      <div className="min-h-0 flex-1">
        {t.scene ? (
          <SceneCanvas
            scene={t.scene}
            tokens={t.tokens}
            dragGhosts={t.dragGhosts}
            canMove={t.canMove}
            onMove={t.actions.move}
            onDragFrame={t.actions.sendDrag}
          />
        ) : (
          <div className="p-6 text-[11px] text-ht-muted">
            No active scene yet{t.isDm ? ' — create one from the scene drawer (next task)' : ' — the DM hasn’t opened a map'}.
          </div>
        )}
      </div>
    </div>
  );
}
