import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useParams, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { getCharacter } from "./lib/characters";
import { getStarship } from "./lib/starships";
import RollDock from "./components/RollDock";
import { RollTriggerProvider } from "./components/RollableText";
import SplitPage from "./components/SplitPage";
import { splitPath } from "./lib/panels";
import SinglePanel from "./layouts/SinglePanel";
import CharacterSheet from "./panels/CharacterSheet";
import ShipSheet from "./panels/ShipSheet";
import Tabletop from "./panels/Tabletop";
import DMScreen from "./panels/DMScreen";
import DmHome from "./panels/DmHome";
import PlayerHome from "./panels/PlayerHome";

function SheetPage() {
  const { characterId = "" } = useParams();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getCharacter(characterId)
      .then((c) => alive && setCampaignId(c.campaign_id))
      .catch(() => alive && setCampaignId(null));
    return () => {
      alive = false;
    };
  }, [characterId]);
  const body = (
    <>
      <CharacterSheet characterId={characterId} />
      {campaignId && <RollDock campaignId={campaignId} />}
    </>
  );
  return (
    <SinglePanel>
      {campaignId ? <RollTriggerProvider campaignId={campaignId}>{body}</RollTriggerProvider> : body}
    </SinglePanel>
  );
}

function ShipPage() {
  const { shipId = "" } = useParams();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getStarship(shipId)
      .then((s) => alive && setCampaignId(s.campaign_id))
      .catch(() => alive && setCampaignId(null));
    return () => {
      alive = false;
    };
  }, [shipId]);
  const body = (
    <>
      <ShipSheet shipId={shipId} />
      {campaignId && <RollDock campaignId={campaignId} />}
    </>
  );
  return (
    <SinglePanel>
      {campaignId ? <RollTriggerProvider campaignId={campaignId}>{body}</RollTriggerProvider> : body}
    </SinglePanel>
  );
}

function MapPage() {
  const { campaignId = "" } = useParams();
  return (
    <SinglePanel>
      <div className="h-full">
        <Tabletop campaignId={campaignId} />
      </div>
    </SinglePanel>
  );
}

function DmPage() {
  const { campaignId = "" } = useParams();
  return (
    <SinglePanel>
      <DMScreen campaignId={campaignId} />
    </SinglePanel>
  );
}

function PlayPage() {
  const { characterId = "" } = useParams();
  const { search } = useLocation();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getCharacter(characterId)
      .then((c) => alive && setCampaignId(c.campaign_id))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [characterId]);
  if (failed) return <Navigate replace to={`/sheet/${characterId}${search}`} />;
  if (!campaignId) return <SinglePanel><div className="p-6 text-zinc-500">Loading…</div></SinglePanel>;
  return (
    <Navigate
      replace
      to={splitPath({ kind: "sheet", id: characterId }, { kind: "map", id: campaignId }) + search}
    />
  );
}

function Landing() {
  return (
    <SinglePanel>
      <div className="p-6">
        <h1 className="text-2xl font-bold">swdnd</h1>
        <p className="text-zinc-400">Star Wars D&amp;D — sw5e</p>
      </div>
    </SinglePanel>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/player" element={<SinglePanel><PlayerHome /></SinglePanel>} />
          <Route path="/sheet/:characterId" element={<SheetPage />} />
          <Route path="/sheet/:characterId/:mode" element={<SheetPage />} />
          <Route path="/ship/:shipId" element={<ShipPage />} />
          <Route path="/ship/:shipId/:mode" element={<ShipPage />} />
          <Route path="/map/:campaignId" element={<MapPage />} />
          <Route path="/dm" element={<SinglePanel><DmHome /></SinglePanel>} />
          <Route path="/dm/:campaignId" element={<DmPage />} />
          <Route path="/play/:characterId" element={<PlayPage />} />
          <Route path="/split/:left/:right" element={<SplitPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
