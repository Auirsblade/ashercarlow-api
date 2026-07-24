// apps/swdnd/src/panels/Tabletop/TokenImageControls.tsx
import { useRef } from 'react';
import type { TokenDto } from '../../lib/scenes';

export default function TokenImageControls({
  token, onUpload, onClear,
}: {
  token: TokenDto;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <span className="flex items-center gap-1">
      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
      <button type="button" className="ht-step" onClick={() => fileRef.current?.click()}>
        {token.image_path ? '🖼 replace' : '🖼 image'}
      </button>
      {token.image_path && (
        <button type="button" className="text-[10px] text-ht-muted" onClick={onClear}>clear img</button>
      )}
    </span>
  );
}
