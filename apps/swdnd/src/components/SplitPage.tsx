// apps/swdnd/src/components/SplitPage.tsx — /split/:left/:right route.
// Parses both descriptors, renders each panel under a slim chrome bar (⛶
// promotes the half to full screen), and mounts the page's single RollDock.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getCharacter } from '../lib/characters';
import { getStarship } from '../lib/starships';
import { panelPath, parsePanel, type Panel } from '../lib/panels';
import SplitView from '../layouts/SplitView';
import CharacterSheet from '../panels/CharacterSheet';
import ShipSheet from '../panels/ShipSheet';
import Tabletop from '../panels/Tabletop';
import DMScreen from '../panels/DMScreen';
import RollDock from './RollDock';
import { RollTriggerProvider } from './RollableText';
import { SplitContext } from './split';

function PanelBody({ panel }: { panel: Panel }) {
  if (panel.kind === 'sheet') return <CharacterSheet characterId={panel.id} />;
  if (panel.kind === 'ship') return <ShipSheet shipId={panel.id} />;
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
        Unknown panel — expected <code>sheet:&lt;id&gt;</code>, <code>map:&lt;id&gt;</code>,{' '}
        <code>dm:&lt;id&gt;</code> or <code>ship:&lt;id&gt;</code>.{' '}
        <Link className="ht-step" to="/">home</Link>
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
  // resolve a sheet or ship panel's campaign with a one-shot fetch.
  const direct = [l, r].find((p) => p && p.kind !== 'sheet' && p.kind !== 'ship')?.id ?? null;
  const entity = direct ? null : ([l, r].find((p) => p?.kind === 'sheet' || p?.kind === 'ship') ?? null);
  const [entityCampaign, setEntityCampaign] = useState<string | null>(null);
  useEffect(() => {
    setEntityCampaign(null);
    if (!entity) return;
    let alive = true;
    const load = entity.kind === 'ship' ? getStarship(entity.id) : getCharacter(entity.id);
    load
      .then((row) => alive && setEntityCampaign(row.campaign_id))
      .catch(() => {});
    return () => { alive = false; };
  }, [entity?.kind, entity?.id]);
  const dockCampaign = direct ?? entityCampaign;

  const body = (
    <>
      <SplitView
        left={<Half panel={l} other={r} side="left" search={search} key={left} />}
        right={<Half panel={r} other={l} side="right" search={search} key={right} />}
      />
      {dockCampaign && <RollDock campaignId={dockCampaign} />}
    </>
  );
  // Panels that know their own campaign (dm) nest a closer provider inside.
  return dockCampaign ? <RollTriggerProvider campaignId={dockCampaign}>{body}</RollTriggerProvider> : body;
}
