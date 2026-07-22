import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { getCharacter } from "./lib/characters";
import SinglePanel from "./layouts/SinglePanel";
import SplitView from "./layouts/SplitView";
import CharacterSheet from "./panels/CharacterSheet";
import Tabletop from "./panels/Tabletop";
import DMScreen from "./panels/DMScreen";

function SheetPage() {
  const { characterId = "" } = useParams();
  return (
    <SinglePanel>
      <CharacterSheet characterId={characterId} />
    </SinglePanel>
  );
}

function MapPage() {
  const { campaignId = "" } = useParams();
  return (
    <SinglePanel>
      <Tabletop campaignId={campaignId} />
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
  return (
    <SplitView
      left={<CharacterSheet characterId={characterId} />}
      right={campaignId ? <Tabletop campaignId={campaignId} /> : <div className="p-6 text-zinc-500">Loading…</div>}
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
          <Route path="/sheet/:characterId" element={<SheetPage />} />
          <Route path="/sheet/:characterId/:mode" element={<SheetPage />} />
          <Route path="/map/:campaignId" element={<MapPage />} />
          <Route path="/dm/:campaignId" element={<DmPage />} />
          <Route path="/play/:characterId" element={<PlayPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
