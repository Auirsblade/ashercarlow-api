// apps/swdnd/src/panels/Landing/index.tsx — the home page at '/'.
// Admin (session cookie): campaign cards with dm/map nav + expandable rosters.
// Anonymous: remembered-code auto-forward, else the player-code form.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PanelLink } from '../../components/split';
import { useAuth } from '../../lib/auth';
import { listCampaigns, type CampaignDto } from '../../lib/campaigns';
import {
  getPlayerByToken, listCharacters, listPlayers,
  type CharacterDto, type PlayerDto,
} from '../../lib/characters';
import { groupCharactersByPlayer } from '../../lib/landing';
import { clearStoredToken, getStoredToken, setStoredToken } from '../../lib/playerSession';

/** api() throws Error(server message); unknown player codes are the 404 path.
 * The message text belongs to the backend, so sniff loosely rather than compare. */
const isNotFound = (e: unknown) =>
  e instanceof Error && /unknown|not found/i.test(e.message);

interface Roster { players: PlayerDto[]; characters: CharacterDto[] }

function InviteButton({ player }: { player: PlayerDto }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const link = `${window.location.origin}/player?token=${encodeURIComponent(player.access_token)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy the invite link:', link);
    }
  };
  return (
    <button type="button" className="ht-step text-[10px]" onClick={() => void copy()}>
      {copied ? 'copied ✓' : 'copy invite link'}
    </button>
  );
}

function CampaignCard({ campaign }: { campaign: CampaignDto }) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const toggle = () => {
    setOpen((o) => !o);
    if (roster || loading.current) return;
    loading.current = true;
    setError(null);
    Promise.all([listPlayers(campaign.id), listCharacters(campaign.id)])
      .then(([players, characters]) => setRoster({ players, characters }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load players'))
      .finally(() => { loading.current = false; });
  };

  return (
    <div className="ht-panel flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[140px] text-ht-bright">{campaign.name}</div>
        <PanelLink className="ht-step text-[10px]" to={{ kind: 'dm', id: campaign.id }}>⌘ dm screen</PanelLink>
        <PanelLink className="ht-step text-[10px]" to={{ kind: 'map', id: campaign.id }}>⬡ map</PanelLink>
        <button type="button" className="ht-step text-[10px]" onClick={toggle}>
          {open ? 'players ▴' : 'players ▾'}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 border-t border-ht-line pt-2">
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          {!roster && !error && <div className="text-[11px] text-ht-muted">Loading…</div>}
          {roster && groupCharactersByPlayer(roster.players, roster.characters).map((g) => (
            <div key={g.player?.id ?? 'unassigned'} className="flex flex-wrap items-center gap-2">
              <div className="min-w-[110px] text-[11px] text-ht-text">
                {g.player ? g.player.name : <span className="text-ht-muted">unassigned</span>}
              </div>
              {g.characters.length === 0 && (
                <span className="text-[10px] text-ht-muted">(no characters yet)</span>
              )}
              {g.characters.map((c) => (
                <PanelLink key={c.id} className="ht-step text-[10px]" to={{ kind: 'sheet', id: c.id }}>
                  ▤ {c.name}
                </PanelLink>
              ))}
              {g.player && <InviteButton player={g.player} />}
            </div>
          ))}
          {roster && roster.players.length === 0 && roster.characters.length === 0 && (
            <div className="text-[11px] text-ht-muted">No players yet — invite them from the DM console.</div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminHome() {
  const [campaigns, setCampaigns] = useState<CampaignDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load campaigns'));
  }, []);

  return (
    <>
      <div className="ht-glow mb-3 rounded-md p-3">
        <div className="ht-name text-sm font-bold">swdnd</div>
        <div className="text-[10px] text-ht-muted">campaigns — ⌘ dm</div>
      </div>
      {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}
      {!campaigns && !error && <div className="text-ht-muted">Loading…</div>}
      {campaigns && campaigns.length === 0 && (
        <div className="text-[11px] text-ht-muted">
          {/* Plain Link: panelPath needs an id, and /dm (DmHome) is a non-panel screen. */}
          No campaigns yet — <Link className="underline" to="/dm">open the DM console</Link> to create one.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {campaigns?.map((c) => <CampaignCard key={c.id} campaign={c} />)}
      </div>
    </>
  );
}

function PlayerGate() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Distinguishes "checking a remembered code" from "showing the form".
  const [checkingStored, setCheckingStored] = useState(() => getStoredToken() !== null);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) return;
    let live = true;
    getPlayerByToken(stored)
      .then(() => { if (live) navigate(`/player?token=${encodeURIComponent(stored)}`, { replace: true }); })
      .catch((e) => {
        if (!live) return;
        if (isNotFound(e)) clearStoredToken(); // revoked — forget silently
        else setError(e instanceof Error ? e.message : 'Could not reach the server');
        setCheckingStored(false);
      });
    return () => { live = false; };
  }, [navigate]);

  const submit = () => {
    const trimmed = code.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    getPlayerByToken(trimmed)
      .then(() => {
        setStoredToken(trimmed);
        navigate(`/player?token=${encodeURIComponent(trimmed)}`);
      })
      .catch((e) => {
        setError(isNotFound(e) ? 'unknown player code' : e instanceof Error ? e.message : 'Could not reach the server');
        setBusy(false);
      });
  };

  if (checkingStored && !error) return <div className="text-ht-muted">Loading…</div>;

  return (
    <div className="ht-panel flex max-w-md flex-col gap-3 p-4">
      <div>
        <div className="ht-name text-sm font-bold">swdnd</div>
        <div className="text-[10px] text-ht-muted">Star Wars D&D — sw5e</div>
      </div>
      <div className="text-[11px] text-ht-muted">
        Enter your player code (from your invite link) to open your characters.
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <input
          className="flex-1 border-b border-ht-line bg-transparent px-1 text-[12px] text-ht-bright outline-none"
          placeholder="player code…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        <button type="submit" className="ht-step" disabled={code.trim() === '' || busy}>
          {busy ? 'checking…' : 'enter'}
        </button>
      </form>
      {error && <div className="text-[11px] text-red-400">{error}</div>}
    </div>
  );
}

export default function Landing() {
  const { authed, loading } = useAuth();
  if (loading) return <div className="ht-screen min-h-screen p-4 font-mono text-ht-muted">Loading…</div>;
  return (
    <div className="ht-screen min-h-screen p-4 font-mono text-ht-text">
      {authed ? <AdminHome /> : <PlayerGate />}
    </div>
  );
}
