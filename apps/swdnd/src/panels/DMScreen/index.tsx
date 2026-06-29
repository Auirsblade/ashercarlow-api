export default function DMScreen({ campaignId }: { campaignId: string }) {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">DM Screen</h1>
      <p className="text-zinc-400">Campaign: {campaignId || "—"}</p>
      <p className="mt-4 text-zinc-500">
        Coming soon — campaign control surface.
      </p>
    </section>
  );
}
