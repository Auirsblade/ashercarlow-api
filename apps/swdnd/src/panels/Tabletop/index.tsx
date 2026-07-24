// apps/swdnd/src/panels/Tabletop/index.tsx
import { useState } from 'react';
import { PanelLink } from '../../components/split';
import RollDock from '../../components/RollDock';
import { useTabletop } from '../../hooks/useTabletop';
import type { GridConfig } from '../../lib/hex';
import { nextTurn, prevTurn } from '../../lib/initiative';
import SceneCanvas from './SceneCanvas';
import SceneDrawer from './SceneDrawer';
import GridCalibrator from './GridCalibrator';
import TokenEditor from './TokenEditor';
import TokenImageControls from './TokenImageControls';
import InitiativeStrip from './InitiativeStrip';
import InitiativeEditor from './InitiativeEditor';

export default function Tabletop({ campaignId }: { campaignId: string }) {
  const t = useTabletop(campaignId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [fogTool, setFogTool] = useState<{ mode: 'reveal' | 'hide'; radius: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<'move' | 'ruler' | 'ping' | 'blast' | 'cone' | 'line'>('move');
  const [templateSize, setTemplateSize] = useState(2);
  const [initEditorOpen, setInitEditorOpen] = useState(false);

  if (t.loading) return <div className="ht-screen min-h-full p-6 font-mono text-ht-muted">Loading map…</div>;

  const grid = t.scene?.grid_json;
  const selected = t.tokens.find((tok) => tok.id === selectedId) ?? null;

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
        {!t.isDm && t.ownCharacters.map((c) => (
          <PanelLink
            key={c.id}
            to={{ kind: 'sheet', id: c.id }}
            current={{ kind: 'map', id: campaignId }}
            className="ht-step"
            title={`open ${c.name}'s sheet (alt-click: beside the map)`}
          >
            ▤ {c.name}
          </PanelLink>
        ))}
        {t.isDm && (
          <PanelLink
            to={{ kind: 'dm', id: campaignId }}
            current={{ kind: 'map', id: campaignId }}
            className="ht-step"
            title="open the DM screen (alt-click: beside the map)"
          >
            ⌘ dm
          </PanelLink>
        )}
        {t.scene && (
          <span className="flex flex-wrap items-center gap-1">
            {([['move', '✥'], ['ruler', '⟋'], ['ping', '◎'], ['blast', '⊚'], ['cone', '◠'], ['line', '⁄']] as const).map(([m, icon]) => (
              <button
                key={m} type="button" title={m}
                className={`ht-step ${tool === m ? 'ht-tile-active' : ''}`}
                onClick={() => setTool((cur) => (cur === m ? 'move' : m))}
              >
                {icon}
              </button>
            ))}
            {(tool === 'blast' || tool === 'cone') && (
              <select
                className="border-b border-ht-line bg-transparent text-[10px] text-ht-bright outline-none"
                value={templateSize}
                onChange={(e) => setTemplateSize(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n} hex</option>)}
              </select>
            )}
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
                <button
                  type="button"
                  className={`ht-step ${fogTool ? 'ht-tile-active' : ''}`}
                  onClick={() => setFogTool((v) => (v ? null : { mode: 'reveal', radius: 1 }))}
                >
                  ☁ fog
                </button>
                {fogTool && (
                  <>
                    <button
                      type="button"
                      className={`ht-step ${fogTool.mode === 'reveal' ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, mode: 'reveal' } : v))}
                    >
                      reveal
                    </button>
                    <button
                      type="button"
                      className={`ht-step ${fogTool.mode === 'hide' ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, mode: 'hide' } : v))}
                    >
                      erase
                    </button>
                    <button
                      type="button"
                      className={`ht-step ${fogTool.radius === 0 ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, radius: 0 } : v))}
                    >
                      1
                    </button>
                    <button
                      type="button"
                      className={`ht-step ${fogTool.radius === 1 ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, radius: 1 } : v))}
                    >
                      7
                    </button>
                    <button
                      type="button"
                      className={`ht-step ${fogTool.radius === 2 ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, radius: 2 } : v))}
                    >
                      19
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={`ht-step ${initEditorOpen ? 'ht-tile-active' : ''}`}
                  onClick={() => setInitEditorOpen((v) => !v)}
                >
                  ♞ init
                </button>
                <button type="button" className="ht-step" onClick={() => void t.actions.clearAllTemplates()}>
                  ✕ tpl
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
      {t.isDm && selected && (
        <div className="mx-2 mb-2">
          <TokenEditor
            token={selected}
            campaignId={campaignId}
            onEdit={(id, body) => void t.actions.editToken(id, body)}
            onDelete={(id) => void t.actions.removeToken(id)}
            onImageUpload={(id, file) => void t.actions.setTokenImage(id, file)}
            onImageClear={(id) => void t.actions.clearTokenImage(id)}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
      {!t.isDm && selected && selected.character_id && t.ownCharacterIds.has(selected.character_id) && (
        <div className="mx-2 mb-2">
          <div className="ht-panel flex items-center gap-3 p-2 text-[11px]">
            <span className="ht-label">{selected.name}</span>
            <TokenImageControls
              token={selected}
              onUpload={(f) => void t.actions.setTokenImage(selected.id, f)}
              onClear={() => void t.actions.clearTokenImage(selected.id)}
            />
            <button type="button" className="ht-step ml-auto" onClick={() => setSelectedId(null)}>✕ close</button>
          </div>
        </div>
      )}
      {t.isDm && initEditorOpen && (
        <div className="mx-2 mb-2">
          <InitiativeEditor
            initiative={t.initiative}
            tokens={t.tokens}
            onChange={(init) => void t.actions.setInitiative(init)}
            onClose={() => setInitEditorOpen(false)}
          />
        </div>
      )}
      {t.initiative && (
        <InitiativeStrip
          initiative={t.initiative}
          isDm={t.isDm}
          onNext={() => void t.actions.setInitiative(nextTurn(t.initiative!))}
          onPrev={() => void t.actions.setInitiative(prevTurn(t.initiative!))}
          onEnd={() => void t.actions.setInitiative(null)}
        />
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
            isDm={t.isDm}
            ownCharacterIds={t.ownCharacterIds}
            vitals={t.vitals}
            fogBrush={t.isDm ? fogTool : null}
            onFogCommit={(reveal, hide) => void t.actions.commitFog(reveal, hide)}
            onSelectToken={setSelectedId}
            mode={tool}
            templateSize={templateSize}
            templates={t.templates}
            pings={t.pings}
            rulers={t.rulers}
            activeTokenId={t.initiative ? t.initiative.order[t.initiative.activeIndex]?.tokenId ?? null : null}
            onPing={t.actions.sendPing}
            onRulerFrame={t.actions.sendRuler}
            onCreateTemplate={(b) => void t.actions.addTemplate(b)}
            onDeleteTemplate={(id) => void t.actions.removeTemplate(id)}
          />
        ) : (
          <div className="p-6 text-[11px] text-ht-muted">
            No active scene yet{t.isDm ? ' — open ▤ scenes to create one' : ' — the DM hasn’t opened a map'}.
          </div>
        )}
      </div>
      <RollDock campaignId={campaignId} />
    </div>
  );
}
