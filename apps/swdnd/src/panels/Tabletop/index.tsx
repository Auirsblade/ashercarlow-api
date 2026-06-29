import { useEffect, useState } from "react";
import { connectCampaign } from "../../lib/ws";

export default function Tabletop({ campaignId }: { campaignId: string }) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (!campaignId) return;
    const sock = connectCampaign(
      campaignId,
      (env) => setEvents((prev) => [env.type, ...prev].slice(0, 20)),
      setConnected,
    );
    return () => sock.close();
  }, [campaignId]);

  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">Tabletop / Map</h1>
      <p className="text-zinc-400">
        Campaign: {campaignId || "—"} · {connected ? "live" : "connecting…"}
      </p>
      <ul className="mt-4 space-y-1 text-sm text-zinc-500">
        {events.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <p className="mt-4 text-zinc-500">Coming soon — real-time shared map.</p>
    </section>
  );
}
