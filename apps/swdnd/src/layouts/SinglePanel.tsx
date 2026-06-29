import type { ReactNode } from "react";

export default function SinglePanel({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>
  );
}
