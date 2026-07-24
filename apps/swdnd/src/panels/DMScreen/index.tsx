// apps/swdnd/src/panels/DMScreen/index.tsx — DM campaign control surface.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useDmScreen } from '../../hooks/useDmScreen';
import PartyRail from './PartyRail';
import AdminDrawer from './AdminDrawer';
import MonsterBrowser from './MonsterBrowser';
import EncounterList from './EncounterList';
import Reference from './Reference';
import { addMonster } from '../../lib/encounters';

const TABS = ['monsters', 'encounters', 'reference'] as const;
type Tab = (typeof TABS)[number];

export default function DMScreen({ campaignId }: { campaignId: string }) {
  const { authed, loading: authLoading } = useAuth();
  const dm = useDmScreen(campaignId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('monsters');

  if (authLoading || dm.loading) return <div className="p-6 font-mono text-ht-muted">Loading…</div>;
  if (!authed) {
    return (
      <div className="p-6 font-mono text-ht-muted">
        DM login required — this screen needs the admin session cookie.
      </div>
    );
  }

  return (
    <div className="ht-screen @container relative min-h-screen font-mono text-ht-text">
      <header className="ht-glow m-3 flex flex-wrap items-center gap-3 rounded-md p-3">
        <div>
          <div className="ht-name text-sm font-bold">{dm.campaign?.name ?? campaignId}</div>
          <div className="text-[10px] text-ht-muted">dm screen</div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          <Link className="ht-step" to={`/map/${campaignId}`}>map</Link>
          <Link className="ht-step" to="/dm">campaigns</Link>
          <button type="button" className="ht-step" onClick={() => setDrawerOpen(true)}>admin</button>
        </div>
      </header>

      {dm.error && <div className="mx-3 mb-2 text-[11px] text-red-400">{dm.error}</div>}

      <div className="flex flex-col gap-3 p-3 pt-0 @[860px]:flex-row">
        <aside className="@[860px]:w-[260px] @[860px]:shrink-0">
          <PartyRail cards={dm.cards} />
        </aside>
        <main className="min-w-0 flex-1">
          <nav className="mb-2 flex gap-1 text-[11px]">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                className={`ht-step ${tab === t ? 'ht-tile-active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="ht-panel p-4">
            {tab === 'monsters' && (
              <MonsterBrowser
                monsters={dm.monsters}
                encounters={dm.encounters}
                onSpawn={(view, count) => void dm.actions.spawn(view, count)}
                onAddToEncounter={(encounterId, monsterId) => {
                  const enc = dm.encounters.find((e) => e.id === encounterId);
                  if (enc) void dm.actions.setEncounterMonsters(encounterId, addMonster(enc.monsters_json, monsterId));
                }}
              />
            )}
            {tab === 'encounters' && (
              <EncounterList
                encounters={dm.encounters}
                monsters={dm.monsters}
                onCreate={(name) => void dm.actions.addEncounter(name)}
                onRename={(id, name) => void dm.actions.renameEncounter(id, name)}
                onSetMonsters={(id, monsters) => void dm.actions.setEncounterMonsters(id, monsters)}
                onSpawnAll={(enc) => void dm.actions.spawnEncounter(enc)}
                onDelete={(id) => void dm.actions.removeEncounter(id)}
              />
            )}
            {tab === 'reference' && (
              <Reference
                conditions={dm.refEntries.conditions}
                powers={dm.refEntries.powers}
                weaponProperties={dm.refEntries.weaponProperties}
              />
            )}
          </div>
        </main>
      </div>

      {drawerOpen && (
        <AdminDrawer
          campaign={dm.campaign}
          players={dm.players}
          cards={dm.cards}
          actions={dm.actions}
          campaignId={campaignId}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
