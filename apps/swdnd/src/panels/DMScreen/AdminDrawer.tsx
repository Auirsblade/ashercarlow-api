// apps/swdnd/src/panels/DMScreen/AdminDrawer.tsx — campaign admin in a drawer.
import { useState } from 'react';
import { PanelLink } from '../../components/split';
import type { CampaignDto } from '../../lib/campaigns';
import type { PlayerDto } from '../../lib/characters';
import type { PartyCard } from '../../lib/partyCards';
import type { DmScreenState } from '../../hooks/useDmScreen';
import BufferedText from './BufferedText';

interface Props {
  campaign: CampaignDto | null;
  players: PlayerDto[];
  cards: PartyCard[];
  actions: DmScreenState['actions'];
  campaignId: string;
  onClose: () => void;
}

export default function AdminDrawer({ campaign, players, cards, actions, campaignId, onClose }: Props) {
  const [newPlayer, setNewPlayer] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyInvite = async (p: PlayerDto) => {
    const link = `${window.location.origin}/player?token=${encodeURIComponent(p.access_token)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(p.id);
    } catch {
      // No clipboard (insecure origin): show the link so the DM can copy manually.
      window.prompt('Copy the invite link:', link);
      return;
    }
    setTimeout(() => setCopied((cur) => (cur === p.id ? null : cur)), 1500);
  };
  const addPlayer = async () => {
    if (!newPlayer.trim()) return;
    await actions.addPlayer(newPlayer.trim());
    setNewPlayer('');
  };

  return (
    <div className="absolute inset-0 z-20" role="dialog" aria-label="campaign admin">
      <button type="button" aria-label="close admin drawer" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="ht-panel absolute inset-y-0 right-0 flex w-[min(360px,90vw)] flex-col gap-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <span className="ht-label">Campaign admin</span>
          <button type="button" className="ht-step" onClick={onClose}>close</button>
        </div>

        <section>
          <div className="ht-label mb-1">Campaign</div>
          {campaign && (
            <BufferedText
              value={campaign.name}
              onCommit={(name) => void actions.renameCampaign(name)}
              className="w-full border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
            />
          )}
          <PanelLink to={{ kind: 'map', id: campaignId }} current={{ kind: 'dm', id: campaignId }} className="ht-step mt-2 inline-block text-[11px]">open map</PanelLink>
        </section>

        <section>
          <div className="ht-label mb-1">Players</div>
          <div className="mb-2 text-[9px] text-ht-muted">
            deleting a slot keeps its characters (ownerless until reassigned)
          </div>
          <div className="flex flex-col gap-2">
            {players.length === 0 && <div className="text-[10px] text-ht-muted">No player slots yet.</div>}
            {players.map((p) => (
              <div key={p.id} className="border-b border-ht-line pb-2">
                <div className="flex items-center gap-2">
                  <BufferedText
                    value={p.name}
                    onCommit={(name) => void actions.renamePlayerSlot(p.id, name)}
                    className="min-w-0 flex-1 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
                  />
                  {confirmDelete === p.id ? (
                    <span className="flex items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        className="ht-step text-red-400"
                        onClick={() => { setConfirmDelete(null); void actions.removePlayer(p.id); }}
                      >
                        confirm ✕
                      </button>
                      <button type="button" className="ht-step" onClick={() => setConfirmDelete(null)}>keep</button>
                    </span>
                  ) : (
                    <button type="button" className="text-[10px] text-ht-muted" onClick={() => setConfirmDelete(p.id)}>
                      delete
                    </button>
                  )}
                </div>
                <button type="button" className="ht-step mt-1 text-[10px]" onClick={() => void copyInvite(p)}>
                  {copied === p.id ? 'copied ✓' : 'copy invite link'}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
              placeholder="new player name…"
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addPlayer()}
            />
            <button type="button" className="ht-step" onClick={() => void addPlayer()}>+ add</button>
          </div>
        </section>

        <section>
          <div className="ht-label mb-1">Characters</div>
          <div className="flex flex-col gap-1">
            {cards.length === 0 && <div className="text-[10px] text-ht-muted">No characters yet.</div>}
            {cards.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-ht-bright">{c.name}</span>
                <span className="text-[10px] text-ht-muted">{c.classLine}</span>
                <PanelLink to={{ kind: 'sheet', id: c.id }} current={{ kind: 'dm', id: campaignId }} className="ht-step ml-auto">sheet</PanelLink>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
