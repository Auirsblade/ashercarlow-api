import type { ReactNode } from "react";

export default function SplitView({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 grid grid-cols-1 md:grid-cols-2 md:divide-x divide-zinc-800">
      <div className="overflow-auto">{left}</div>
      <div className="overflow-auto">{right}</div>
    </div>
  );
}
