// apps/swdnd/src/panels/DMScreen/BufferedText.tsx
import { useEffect, useState } from 'react';

/** Text input that buffers edits locally and commits the trimmed value on
 * blur (Enter blurs). No-ops on empty or unchanged values. */
export default function BufferedText({
  value, onCommit, className, placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={className}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.trim();
        if (t && t !== value) onCommit(t);
        else setDraft(value);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
