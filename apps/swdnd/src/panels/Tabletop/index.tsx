// apps/swdnd/src/panels/Tabletop/index.tsx
import { useState } from 'react';
import { PanelLink } from '../../components/split';
import RollDock from '../../components/RollDock';
import { useTabletop } from '../../hooks/useTabletop';
import { gridUnits, type GridConfig } from '../../lib/hex';
import { nextTurn, prevTurn } from '../../lib/initiative';
import { conditionColor } from '../../lib/rings';
import { setSystemDamage, toggleShipCondition } from '../../lib/shipPlay';
import { isOwnToken } from '../../lib/visibility';
import { SW5E_CONDITIONS } from '../CharacterSheet/Sheet/ConditionsMenu';
import SceneCanvas from './SceneCanvas';
import SceneDrawer from './SceneDrawer';
import GridCalibrator from './GridCalibrator';
import ShipStatusMenu from './ShipStatusMenu';
import ShipSpawner from './ShipSpawner';
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
  const [selectedTplId, setSelectedTplId] = useState<string | null>(null);
  const [tool, setTool] = useState<'move' | 'ruler' | 'ping' | 'blast' | 'cone' | 'line'>('move');
  const [templateSize, setTemplateSize] = useState(2);
  const [initEditorOpen, setInitEditorOpen] = useState(false);
  const [shipDrawerOpen, setShipDrawerOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ tokenId: string; x: number; y: number } | null>(null);

  if (t.loading) return <div className="ht-screen min-h-full p-6 font-mono text-ht-muted">Loading map…</div>;

  const grid = t.scene?.grid_json;
  const selected = t.tokens.find((tok) => tok.id === selectedId) ?? null;
  const selectedTpl = t.templates.find((tpl) => tpl.id === selectedTplId) ?? null;

  return (
    <div className="@container ht-screen flex h-full min-h-full flex-col font-mono text-ht-text">
      {t.error && (
        <div className="m-2 rounded border border-red-400/60 bg-red-950/40 px-3 py-1.5 text-[11px] text-red-300">
          ⚠ {t.error}
        </div>
      )}
      <div className="ht-glow m-2 flex flex-wrap items-center gap-3 rounded-md p-2 text-[11px]">
        <span className="ht-name font-bold">{t.scene?.name ?? 'No active scene'}</span>
        {t.scene && (
          <span className="text-[10px] text-ht-muted">
            {t.scene.mode === 'space' ? '✦ space' : '⛰ ground'} · {gridUnits(t.scene.grid_json).per}{' '}
            {gridUnits(t.scene.grid_json).label}/hex · {t.tokens.length} tokens
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
            {([
              ['move', '✥', 'move — drag tokens, tap to select, drag empty map to pan'],
              ['ruler', '⟋', 'ruler — drag to measure distance'],
              ['ping', '◎', 'ping — tap to flash a marker everyone sees'],
              ['blast', '⊚', 'blast — tap to place a circular area template'],
              ['cone', '◠', 'cone — drag from origin to aim a cone template'],
              ['line', '⁄', 'line — drag to place a line template'],
            ] as const).map(([m, icon, tip]) => (
              <button
                key={m} type="button" title={tip}
                className={`ht-step ${tool === m ? 'ht-tile-active' : ''}`}
                onClick={() => setTool((cur) => (cur === m ? 'move' : m))}
              >
                {icon}
              </button>
            ))}
            {(tool === 'blast' || tool === 'cone') && (
              <select
                className="border-b border-ht-line bg-transparent text-[10px] text-ht-bright outline-none"
                title="template size in hexes"
                value={templateSize}
                onChange={(e) => setTemplateSize(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} hex · {n * gridUnits(t.scene!.grid_json).per} {gridUnits(t.scene!.grid_json).label}
                  </option>
                ))}
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
                  title="type a name and press Enter to drop a token"
                  placeholder="token name…" value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTokenName.trim()) {
                      void t.actions.addToken({ name: newTokenName.trim(), faction: 'hostile', color: '#ff5470' });
                      setNewTokenName('');
                    }
                  }}
                />
                <button type="button" title="calibrate the hex grid to the map image" className={`ht-step ${calibrating ? 'ht-tile-active' : ''}`} onClick={() => setCalibrating((v) => !v)}>
                  ⬡ grid
                </button>
                <button
                  type="button"
                  title="space encounter — 50 ft/hex, ship tokens and space conditions"
                  className={`ht-step ${t.scene.mode === 'space' ? 'ht-tile-active' : ''}`}
                  onClick={() => void t.actions.setSceneMode(t.scene!.id, t.scene!.mode === 'space' ? 'ground' : 'space')}
                >
                  ✦ space
                </button>
                <button
                  type="button"
                  title="spawn a campaign starship as a token"
                  className={`ht-step ${shipDrawerOpen ? 'ht-tile-active' : ''}`}
                  onClick={() => { t.actions.loadShips(); setShipDrawerOpen((v) => !v); }}
                >
                  ⛴ ship
                </button>
                <button
                  type="button"
                  title="fog of war — paint hexes to reveal or hide them"
                  className={`ht-step ${fogTool ? 'ht-tile-active' : ''}`}
                  onClick={() => setFogTool((v) => (v ? null : { mode: 'reveal', radius: 1 }))}
                >
                  ☁ fog
                </button>
                {fogTool && (
                  <>
                    <button
                      type="button"
                      title="brush reveals hexes to the players"
                      className={`ht-step ${fogTool.mode === 'reveal' ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, mode: 'reveal' } : v))}
                    >
                      reveal
                    </button>
                    <button
                      type="button"
                      title="brush hides hexes again"
                      className={`ht-step ${fogTool.mode === 'hide' ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, mode: 'hide' } : v))}
                    >
                      erase
                    </button>
                    <button
                      type="button"
                      title="brush size: 1 hex"
                      className={`ht-step ${fogTool.radius === 0 ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, radius: 0 } : v))}
                    >
                      1
                    </button>
                    <button
                      type="button"
                      title="brush size: 7 hexes"
                      className={`ht-step ${fogTool.radius === 1 ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, radius: 1 } : v))}
                    >
                      7
                    </button>
                    <button
                      type="button"
                      title="brush size: 19 hexes"
                      className={`ht-step ${fogTool.radius === 2 ? 'ht-tile-active' : ''}`}
                      onClick={() => setFogTool((v) => (v ? { ...v, radius: 2 } : v))}
                    >
                      19
                    </button>
                  </>
                )}
                <button
                  type="button"
                  title="initiative tracker — set the turn order"
                  className={`ht-step ${initEditorOpen ? 'ht-tile-active' : ''}`}
                  onClick={() => setInitEditorOpen((v) => !v)}
                >
                  ♞ init
                </button>
                <button type="button" title="clear all area templates" className="ht-step" onClick={() => void t.actions.clearAllTemplates()}>
                  ✕ tpl
                </button>
              </>
            )}
            <button type="button" title="scene manager — create, upload and switch maps" className={`ht-step ${drawerOpen ? 'ht-tile-active' : ''}`} onClick={() => setDrawerOpen((v) => !v)}>
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
      {t.isDm && shipDrawerOpen && (
        <div className="mx-2 mb-2">
          <ShipSpawner
            ships={t.ships}
            onSpawn={(id) => void t.actions.spawnShip(id)}
            onClose={() => setShipDrawerOpen(false)}
          />
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
      {!t.isDm && selected && isOwnToken(selected, { ownCharacterIds: t.ownCharacterIds, ownShipIds: t.ownShipIds }) && (
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
      {selectedTpl && (
        <div className="mx-2 mb-2">
          <div className="ht-panel flex flex-wrap items-center gap-2 p-2 text-[11px]">
            <span className="ht-label">{selectedTpl.kind} template</span>
            {['#c792ea', '#ff5470', '#ffcb6b', '#5dd39e', '#4dd0e1', '#f5fbff'].map((c) => (
              <button
                key={c} type="button" title={`recolor template ${c}`}
                className={`h-4 w-4 rounded-full border ${selectedTpl.color === c ? 'border-ht-bright ring-1 ring-ht-bright' : 'border-ht-line'}`}
                style={{ background: c }}
                onClick={() => void t.actions.editTemplate(selectedTpl.id, { color: c })}
              />
            ))}
            <span className="text-[10px] text-ht-muted">drag its center dot on the map to move it</span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button" className="ht-step text-red-400" title="delete this template"
                onClick={() => { void t.actions.removeTemplate(selectedTpl.id); setSelectedTplId(null); }}
              >
                ✕ delete
              </button>
              <button type="button" className="ht-step" title="close" onClick={() => setSelectedTplId(null)}>✕ close</button>
            </span>
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
          nameOf={(id) => t.tokens.find((tok) => tok.id === id)?.name ?? '—'}
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
            shipVitals={t.shipVitals}
            ownShipIds={t.ownShipIds}
            selectedTokenId={selectedId}
            onRotate={(id, facing) => void t.actions.rotate(id, facing)}
            activeTokenIds={(() => {
              const e = t.initiative?.order[t.initiative.activeIndex];
              return new Set(e ? [e.tokenId, ...(e.crew ?? [])] : []);
            })()}
            onPing={t.actions.sendPing}
            onRulerFrame={t.actions.sendRuler}
            onCreateTemplate={(b) => void t.actions.addTemplate(b)}
            selectedTemplateId={selectedTplId}
            onSelectTemplate={setSelectedTplId}
            onMoveTemplate={(id, dq, dr) => {
              const tpl = t.templates.find((x) => x.id === id);
              if (!tpl) return;
              void t.actions.editTemplate(id, {
                q: tpl.q + dq, r: tpl.r + dr,
                ...(tpl.q2 != null && tpl.r2 != null ? { q2: tpl.q2 + dq, r2: tpl.r2 + dr } : {}),
              });
            }}
            onTokenContextMenu={(id, x, y) => {
              const tok = t.tokens.find((x2) => x2.id === id);
              if (!tok) return;
              // DMs get every token; a player only their own crewed ship.
              if (t.isDm || (!!tok.ship_id && t.ownShipIds.has(tok.ship_id))) setCtxMenu({ tokenId: id, x, y });
            }}
          />
        ) : (
          <div className="p-6 text-[11px] text-ht-muted">
            No active scene yet{t.isDm ? ' — open ▤ scenes to create one' : ' — the DM hasn’t opened a map'}.
          </div>
        )}
      </div>
      {ctxMenu && (() => {
        const tok = t.tokens.find((x) => x.id === ctxMenu.tokenId);
        if (!tok) return null;
        return (
          <>
            {/* backdrop: any click (or second right-click) closes the menu */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setCtxMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
            />
            <div
              className="ht-panel fixed z-50 w-48 p-1 text-[11px]"
              style={{
                left: Math.min(ctxMenu.x, window.innerWidth - 200),
                top: Math.min(ctxMenu.y, window.innerHeight - 290),
              }}
            >
              {tok.ship_id ? (
                <ShipStatusMenu
                  name={tok.name}
                  vitals={t.shipVitals[tok.ship_id] ?? null}
                  onToggle={(c) => void t.actions.setShipPlay(tok.ship_id!, (doc) => toggleShipCondition(doc, c))}
                  onSystemDamage={(n) => void t.actions.setShipPlay(tok.ship_id!, (doc) => setSystemDamage(doc, n))}
                />
              ) : !t.isDm ? null : ( // defensive: onTokenContextMenu's gate already ensures t.isDm here when !tok.ship_id
                <>
                  <div className="ht-label px-2 py-1">{tok.name} · conditions</div>
                  {tok.character_id ? (
                    <div className="px-2 py-1 text-ht-muted">set from the character sheet</div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      {SW5E_CONDITIONS.map((c) => {
                        const active = tok.conditions_json.includes(c);
                        return (
                          <button
                            key={c} type="button"
                            className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left hover:bg-white/5"
                            onClick={() => void t.actions.editToken(tok.id, {
                              conditions: active
                                ? tok.conditions_json.filter((x) => x !== c)
                                : [...tok.conditions_json, c],
                            })}
                          >
                            <span style={{ color: conditionColor(c) }}>{active ? '◈' : '○'}</span>
                            <span className={active ? 'text-ht-bright' : 'text-ht-text'}>{c}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        );
      })()}
      <RollDock campaignId={campaignId} />
    </div>
  );
}
