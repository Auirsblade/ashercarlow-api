// apps/swdnd/src/panels/DmHome/index.tsx — /dm landing: campaign list/create/rename.
import { useEffect, useState } from 'react';
import { PanelLink } from '../../components/split';
import { useAuth } from '../../lib/auth';
import { createCampaign, listCampaigns, renameCampaign, type CampaignDto } from '../../lib/campaigns';
import BufferedText from '../DMScreen/BufferedText';

export default function DmHome() {
  const { authed, loading: authLoading } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const reload = () => {
    setLoading(true);
    listCampaigns()
      .then((rows) => { setCampaigns(rows); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); setError(null); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
  };
  const create = () => {
    if (!newName.trim()) return;
    void run(async () => { await createCampaign(newName.trim()); setNewName(''); });
  };

  if (authLoading) return <div className="p-6 font-mono text-ht-muted">Loading…</div>;
  if (!authed) {
    return (
      <div className="p-6 font-mono text-ht-muted">
        DM login required — this console needs the admin session cookie.
      </div>
    );
  }

  return (
    <div className="ht-screen min-h-screen p-4 font-mono text-ht-text">
      <div className="ht-glow mb-3 rounded-md p-3">
        <div className="ht-name text-sm font-bold">DM console</div>
        <div className="text-[10px] text-ht-muted">campaigns</div>
      </div>

      {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}
      {loading ? (
        <div className="text-ht-muted">Loading…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {campaigns.length === 0 && (
            <div className="text-[11px] text-ht-muted">No campaigns yet — create one below.</div>
          )}
          {campaigns.map((c) => (
            <div key={c.id} className="ht-panel flex flex-wrap items-center gap-3 p-3">
              <BufferedText
                value={c.name}
                onCommit={(name) => void run(() => renameCampaign(c.id, name))}
                className="min-w-[160px] border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
              />
              <div className="ml-auto flex items-center gap-2 text-[11px]">
                <PanelLink to={{ kind: 'dm', id: c.id }} current={{ kind: 'map', id: c.id }} className="ht-step" title="alt-click: dm screen + map">dm screen</PanelLink>
                <PanelLink to={{ kind: 'map', id: c.id }} current={{ kind: 'dm', id: c.id }} className="ht-step" title="alt-click: map + dm screen">map</PanelLink>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ht-panel mt-3 flex flex-wrap items-center gap-2 p-3">
        <span className="ht-label">New campaign</span>
        <input
          className="w-48 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button type="button" className="ht-step" onClick={create}>+ create</button>
      </div>
    </div>
  );
}
