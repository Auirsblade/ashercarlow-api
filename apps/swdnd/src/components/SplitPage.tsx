// apps/swdnd/src/components/SplitPage.tsx — /split/:left/:right route.
// Parses both descriptors, renders each panel under a slim chrome bar (⛶
// promotes the half to full screen), and mounts the page's single RollDock.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getCharacter } from '../lib/characters';
import { panelPath, parsePanel, type Panel } from '../lib/panels';
import SplitView from '../layouts/SplitView';
import CharacterSheet from '../panels/CharacterSheet';
import Tabletop from '../panels/Tabletop';
import DMScreen from '../panels/DMScreen';
import RollDock from './RollDock';
import { SplitContext } from './split';

function PanelBody({ panel }: { panel: Panel }) {
  if (panel.kind === 'sheet') return <CharacterSheet characterId={panel.id} />;
  if (panel.kind === 'map') return <Tabletop campaignId={panel.id} />;
  return <DMScreen campaignId={panel.id} />;
}

function Half({
  panel, other, side, search,
}: {
  panel: Panel | null;
  other: Panel | null;
  side: 'left' | 'right';
  search: string;
}) {
  if (!panel) {
    return (
      <div className="p-6 font-mono text-[11px] text-ht-muted">
        Unknown panel — expected <code>sheet:&lt;id&gt;</code>, <code>map:&lt;id&gt;</code> or{' '}
        <code>dm:&lt;id&gt;</code>. <Link className="ht-step" to="/">home</Link>
      </div>
    );
  }
  const ctx = {
    left: side === 'left' ? panel : (other ?? panel),
    right: side === 'left' ? (other ?? panel) : panel,
    side,
  };
  return (
    <SplitContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-ht-line px-2 py-0.5 font-mono text-[10px] text-ht-muted">
          <span>{panel.kind}</span>
          <Link
            className="ht-step ml-auto"
            title="expand this panel"
            to={panelPath(panel) + search}
          >
            ⛶
          </Link>
        </div>
        <div className="@container min-h-0 flex-1 overflow-auto">
          <PanelBody panel={panel} />
        </div>
      </div>
    </SplitContext.Provider>
  );
}

export default function SplitPage() {
  const { left = '', right = '' } = useParams();
  const { search } = useLocation();
  const l = parsePanel(left);
  const r = parsePanel(right);

  // The page's single RollDock: first map/dm campaign id (left first), else
  // resolve a sheet panel's campaign with a one-shot fetch.
  const direct = [l, r].find((p) => p && p.kind !== 'sheet')?.id ?? null;
  const sheetId = direct ? null : ([l, r].find((p) => p?.kind === 'sheet')?.id ?? null);
  const [sheetCampaign, setSheetCampaign] = useState<string | null>(null);
  useEffect(() => {
    setSheetCampaign(null);
    if (!sheetId) return;
    let alive = true;
    getCharacter(sheetId)
      .then((c) => alive && setSheetCampaign(c.campaign_id))
      .catch(() => {});
    return () => { alive = false; };
  }, [sheetId]);
  const dockCampaign = direct ?? sheetCampaign;

  return (
    <>
      <SplitView
        left={<Half panel={l} other={r} side="left" search={search} key={left} />}
        right={<Half panel={r} other={l} side="right" search={search} key={right} />}
      />
      {dockCampaign && <RollDock campaignId={dockCampaign} />}
    </>
  );
}
