// apps/swdnd/src/panels/Tabletop/SceneDrawer.tsx
import { useRef, useState } from 'react';
import type { SceneDto } from '../../lib/scenes';

interface Props {
  scenes: SceneDto[];
  activeId: string | null;
  onCreate: (name: string) => void;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
  onUpload: (id: string, file: File, w: number, h: number) => void;
  onClose: () => void;
}

export default function SceneDrawer({ scenes, activeId, onCreate, onActivate, onDelete, onUpload, onClose }: Props) {
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const pickFile = (sceneId: string) => {
    fileFor.current = sceneId;
    fileInput.current?.click();
  };
  const onFile = (file: File | undefined) => {
    const sceneId = fileFor.current;
    if (!file || !sceneId) return;
    // Read natural dimensions client-side; the backend stores what we report.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      onUpload(sceneId, file, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="ht-panel flex flex-col gap-2 p-3 text-[11px]">
      <div className="flex items-center">
        <span className="ht-label">Scenes</span>
        <button type="button" className="ht-step ml-auto" onClick={onClose}>✕ close</button>
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {scenes.map((s) => (
        <div key={s.id} className={`flex flex-wrap items-center gap-2 rounded border border-ht-line p-2 ${s.id === activeId ? 'ht-glow' : ''}`}>
          <span className={s.id === activeId ? 'text-ht-bright' : 'text-ht-text'}>
            {s.id === activeId ? '◉ ' : ''}{s.name}
          </span>
          <span className="text-[10px] text-ht-muted">{s.image_path ? `${s.image_w}×${s.image_h}` : 'no image'}</span>
          <span className="ml-auto flex items-center gap-2">
            <button type="button" className="ht-step" onClick={() => pickFile(s.id)}>{s.image_path ? 'replace image' : 'upload image'}</button>
            {s.id !== activeId && <button type="button" className="ht-step" onClick={() => onActivate(s.id)}>activate ▸</button>}
            {confirmDelete === s.id ? (
              <>
                <button type="button" className="ht-step text-red-400" onClick={() => { onDelete(s.id); setConfirmDelete(null); }}>confirm ✕</button>
                <button type="button" className="ht-step" onClick={() => setConfirmDelete(null)}>keep</button>
              </>
            ) : (
              <button type="button" className="text-[10px] text-ht-muted" onClick={() => setConfirmDelete(s.id)}>delete</button>
            )}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          className="w-40 border-b border-ht-line bg-transparent px-1 text-ht-bright outline-none"
          placeholder="new scene name…" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); } }}
        />
        <button type="button" className="ht-step" onClick={() => { if (name.trim()) { onCreate(name.trim()); setName(''); } }}>
          + create scene
        </button>
      </div>
    </div>
  );
}
