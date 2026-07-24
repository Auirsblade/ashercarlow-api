import type { ReactNode } from "react";

export default function SplitView({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 divide-ht-line md:grid-cols-2 md:divide-x">
      <div className="h-screen overflow-hidden">{left}</div>
      <div className="h-screen overflow-hidden">{right}</div>
    </div>
  );
}
