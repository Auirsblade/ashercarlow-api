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
  return <Sheet characterId={characterId} />;
}
