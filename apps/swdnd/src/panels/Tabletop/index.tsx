// apps/swdnd/src/panels/Tabletop/index.tsx
import { useState } from 'react';
import { useTabletop } from '../../hooks/useTabletop';
import type { GridConfig } from '../../lib/hex';
import SceneCanvas from './SceneCanvas';
import SceneDrawer from './SceneDrawer';
import GridCalibrator from './GridCalibrator';

export default function Tabletop({ campaignId }: { campaignId: string }) {
  const t = useTabletop(campaignId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');

  if (t.loading) return <div className="ht-screen min-h-full p-6 font-mono text-ht-muted">Loading map…</div>;

  const grid = t.scene?.grid_json;

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
        {t.isDm && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {t.scene && (
              <>
                <input
                  className="w-28 border-b border-ht-line bg-transparent px-1 text-[10px] text-ht-bright outline-none"
                  placeholder="token name…" value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTokenName.trim()) {
                      void t.actions.addToken({ name: newTokenName.trim(), faction: 'hostile', color: '#ff5470' });
                      setNewTokenName('');
                    }
                  }}
                />
                <button type="button" className={`ht-step ${calibrating ? 'ht-tile-active' : ''}`} onClick={() => setCalibrating((v) => !v)}>
                  ⬡ grid
                </button>
              </>
            )}
            <button type="button" className={`ht-step ${drawerOpen ? 'ht-tile-active' : ''}`} onClick={() => setDrawerOpen((v) => !v)}>
              ▤ scenes
            </button>
          </span>
        )}
      </div>

      {t.isDm && drawerOpen && (
        <div className="mx-2 mb-2">
          <SceneDrawer
            scenes={t.scenes}
            activeId={t.scene?.id ?? null}
            onCreate={(name) => void t.actions.createScene(name)}
            onActivate={(id) => void t.actions.activate(id)}
            onDelete={(id) => void t.actions.removeScene(id)}
            onUpload={(id, file, w, h) => void t.actions.upload(id, file, w, h)}
            onClose={() => setDrawerOpen(false)}
          />
        </div>
      )}
      {t.isDm && calibrating && t.scene && grid && (
        <div className="mx-2 mb-2">
          <GridCalibrator grid={grid} onChange={(g: GridConfig) => void t.actions.setGrid(t.scene!.id, g)} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {t.scene ? (
          <SceneCanvas
            scene={t.scene}
            tokens={t.tokens}
            dragGhosts={t.dragGhosts}
            canMove={t.canMove}
            onMove={t.actions.move}
            onDragFrame={t.actions.sendDrag}
            calibrating={calibrating}
          />
        ) : (
          <div className="p-6 text-[11px] text-ht-muted">
            No active scene yet{t.isDm ? ' — open ▤ scenes to create one' : ' — the DM hasn’t opened a map'}.
          </div>
        )}
      </div>
    </div>
  );
}
