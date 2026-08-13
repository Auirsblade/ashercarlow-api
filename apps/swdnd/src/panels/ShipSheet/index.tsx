// apps/swdnd/src/panels/ShipSheet/index.tsx
import { useParams } from 'react-router-dom';
import ShipBuilder from './Builder';
import ShipSheetView from './Sheet';

export default function ShipSheet({ shipId }: { shipId: string }) {
  const { mode } = useParams();
  if (mode === 'build') {
    return <ShipBuilder key={shipId} shipId={shipId} />;
  }
  // key: a ship change must remount. Without it, client-side navigation A→B
  // keeps A's loaded state, so a failed load of B would render A's live sheet
  // under B's URL; remounting also strands A's pending save-timer/WS closures
  // on the dead instance instead of leaking into B.
  return <ShipSheetView key={shipId} shipId={shipId} />;
}
