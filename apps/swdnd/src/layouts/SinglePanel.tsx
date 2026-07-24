import type { ReactNode } from "react";

// h-dvh + overflow gives panels a definite height context (mirroring a split
// pane), so full-height panels can use h-full while flow panels still scroll.
export default function SinglePanel({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh overflow-y-auto bg-zinc-950 text-zinc-100">{children}</div>
  );
}
