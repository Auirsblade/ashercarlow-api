// apps/swdnd/src/panels/CharacterSheet/index.tsx
import { useParams } from 'react-router-dom';
import Sheet from './Sheet';

export default function CharacterSheet({ characterId }: { characterId: string }) {
  const { mode } = useParams();
  if (mode === 'build') {
    return (
      <section className="p-6 font-mono text-ht-muted">
        Builder arrives in Phase 3. <a className="text-ht-accent" href={`/sheet/${characterId}`}>← Back to sheet</a>
      </section>
    );
  }
  // key: a character change must remount the sheet. Without it, client-side
  // navigation A→B keeps A's loaded state, so a failed load of B would render
  // A's live sheet under B's URL; remounting also strands A's pending
  // save-timer/WS closures on the dead instance instead of leaking into B.
  return <Sheet key={characterId} characterId={characterId} />;
}
