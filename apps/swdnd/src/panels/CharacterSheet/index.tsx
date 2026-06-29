export default function CharacterSheet({ characterId }: { characterId: string }) {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">Character Sheet</h1>
      <p className="text-zinc-400">Character: {characterId || "—"}</p>
      <p className="mt-4 text-zinc-500">
        Coming soon — built on the sw5e data layer.
      </p>
    </section>
  );
}
