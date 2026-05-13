import {
  createSignal,
  createMemo,
  createEffect,
  Show,
  For,
  type Component,
} from "solid-js";
import { useSearchParams } from "@solidjs/router";
import {
  Share2,
  Search,
  X,
  Plus,
  StickyNote,
  Check,
  ChevronRight,
  Trash2,
  Tag,
} from "lucide-solid";
import { api, authSignal } from "../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Classification = "essential" | "lore_light" | "filler" | null;

type Episode = {
  id: number;
  season: number | null;
  episode: number | null;
  title: string;
  arc: string | null;
  classification: Classification;
  watched: boolean;
  characters: string[];
  notes: string | null;
};

type Character = {
  id: string;
  name: string;
  sort_order: number;
  is_seed: boolean;
  episode_count: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLASSIFICATION_ORDER: Classification[] = [
  null,
  "essential",
  "lore_light",
  "filler",
];

function cycleClassification(current: Classification): Classification {
  const idx = CLASSIFICATION_ORDER.indexOf(current);
  return CLASSIFICATION_ORDER[(idx + 1) % CLASSIFICATION_ORDER.length];
}

function classificationLabel(c: Classification): string {
  if (c === "essential") return "Essential";
  if (c === "lore_light") return "Lore-Light";
  if (c === "filler") return "Filler";
  return "Unreviewed";
}

function classificationColors(c: Classification): string {
  if (c === "essential")
    return "bg-emerald-950/60 text-emerald-400 border border-emerald-800/60";
  if (c === "lore_light")
    return "bg-amber-950/60 text-amber-400 border border-amber-800/60";
  if (c === "filler")
    return "bg-rose-950/60 text-rose-400 border border-rose-900/70";
  return "bg-zinc-900 text-zinc-600 border border-zinc-800";
}

function seLabel(ep: Episode): string {
  if (ep.season === null) return "MOVIE";
  const s = String(ep.season).padStart(2, "0");
  const e = String(ep.episode ?? 0).padStart(2, "0");
  return `S${s}E${e}`;
}

function posLabel(id: number): string {
  return String(id).padStart(3, "0");
}

// ---------------------------------------------------------------------------
// Episode Row
// ---------------------------------------------------------------------------

const EpisodeRow: Component<{
  episode: Episode;
  characters: Character[];
  isOwner: boolean;
  onToggleWatched: () => void;
  onCycleClassification: () => void;
  onOpenDetail: () => void;
  onCharactersChanged: (ids: string[]) => void;
}> = (props) => {
  const ep = () => props.episode;
  const isUnreviewed = () => ep().classification === null;

  const rowCharacters = () =>
    props.characters.filter((c) => ep().characters.includes(c.id));

  return (
    <div
      class={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors cursor-pointer hover:bg-zinc-900/70 group ${
        isUnreviewed() ? "opacity-60" : ""
      }`}
      onClick={(e) => {
        // Don't open detail if clicking interactive controls
        if ((e.target as HTMLElement).closest("[data-no-detail]")) return;
        props.onOpenDetail();
      }}
    >
      {/* Watched checkbox — owner only */}
      <Show when={props.isOwner}>
        <button
          data-no-detail
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleWatched();
          }}
          class={`flex-none w-5 h-5 rounded border flex items-center justify-center transition-colors ${
            ep().watched
              ? "bg-emerald-600 border-emerald-600 text-white"
              : "border-zinc-700 hover:border-zinc-500"
          }`}
          title={ep().watched ? "Mark unwatched" : "Mark watched"}
        >
          <Show when={ep().watched}>
            <Check size={12} />
          </Show>
        </button>
      </Show>

      {/* Position number */}
      <span class="flex-none font-mono text-xs text-zinc-500 w-8">
        {posLabel(ep().id)}
      </span>

      {/* S/E badge */}
      <span class="flex-none font-mono text-xs text-zinc-400 w-14">
        {seLabel(ep())}
      </span>

      {/* Title */}
      <span
        class={`flex-1 text-sm truncate min-w-0 ${
          isUnreviewed() ? "text-zinc-500" : "text-zinc-100"
        }`}
      >
        {ep().title}
      </span>

      {/* Pills area — hidden for unreviewed */}
      <Show when={!isUnreviewed()}>
        {/* Mobile: compact summary (classification pill + character count; arc is in detail) */}
        <div class="md:hidden flex items-center gap-1 flex-none" data-no-detail>
          <Show when={ep().classification}>
            <button
              data-no-detail
              onClick={(e) => {
                e.stopPropagation();
                if (props.isOwner) props.onCycleClassification();
              }}
              class={`px-1.5 py-0.5 rounded text-xs font-medium ${classificationColors(
                ep().classification
              )} ${props.isOwner ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
            >
              {classificationLabel(ep().classification)}
            </button>
          </Show>

          <Show when={rowCharacters().length === 1}>
            <span class="px-1.5 py-0.5 rounded text-xs bg-zinc-800 text-zinc-300 border border-zinc-700">
              {rowCharacters()[0].name}
            </span>
          </Show>
          <Show when={rowCharacters().length > 1}>
            <span class="px-1.5 py-0.5 rounded text-xs bg-zinc-800 text-zinc-300 border border-zinc-700">
              {rowCharacters().length}+
            </span>
          </Show>
        </div>

        {/* Desktop: full pills */}
        <div class="hidden md:flex items-center gap-1.5 flex-none flex-wrap justify-end max-w-xs" data-no-detail>
          {/* Classification pill */}
          <Show when={ep().classification}>
            <button
              data-no-detail
              onClick={(e) => {
                e.stopPropagation();
                if (props.isOwner) props.onCycleClassification();
              }}
              class={`px-1.5 py-0.5 rounded text-xs font-medium transition-opacity ${classificationColors(
                ep().classification
              )} ${props.isOwner ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
              title={
                props.isOwner
                  ? `Click to change classification (${classificationLabel(ep().classification)})`
                  : classificationLabel(ep().classification)
              }
            >
              {classificationLabel(ep().classification)}
            </button>
          </Show>

          {/* Character chips */}
          <For each={rowCharacters()}>
            {(char) => (
              <span class="px-1.5 py-0.5 rounded text-xs bg-zinc-800 text-zinc-300 border border-zinc-700">
                {char.name}
              </span>
            )}
          </For>

          {/* Arc pill */}
          <Show when={ep().arc}>
            <span class="px-1.5 py-0.5 rounded text-xs bg-zinc-900 text-zinc-600 border border-zinc-800">
              {ep().arc}
            </span>
          </Show>
        </div>
      </Show>

      {/* Unreviewed label for viewers */}
      <Show when={isUnreviewed() && !props.isOwner}>
        <span class="flex-none text-xs text-zinc-700 italic">not yet reviewed</span>
      </Show>

      {/* Notes icon */}
      <Show when={ep().notes}>
        <StickyNote size={13} class="flex-none text-zinc-600" />
      </Show>

      {/* Open detail chevron */}
      <ChevronRight
        size={14}
        class="flex-none text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

const DetailPanel: Component<{
  episode: Episode;
  characters: Character[];
  isOwner: boolean;
  onClose: () => void;
  onUpdate: (updated: Partial<Episode>) => void;
  onCharactersChanged: (ids: string[]) => void;
  onAddCharacter: (name: string) => Promise<Character>;
}> = (props) => {
  const ep = () => props.episode;
  const [notes, setNotes] = createSignal(ep().notes ?? "");
  const [saveTimeout, setSaveTimeout] = createSignal<ReturnType<typeof setTimeout> | null>(null);
  const [newCharInput, setNewCharInput] = createSignal("");
  const [addingChar, setAddingChar] = createSignal(false);
  const [charError, setCharError] = createSignal("");

  // Sync notes when episode changes
  createEffect(() => {
    setNotes(ep().notes ?? "");
  });

  const saveNotes = (value: string) => {
    const t = saveTimeout();
    if (t) clearTimeout(t);
    setSaveTimeout(
      setTimeout(async () => {
        try {
          await api(`/swtcw/episodes/${ep().id}`, {
            method: "PATCH",
            body: JSON.stringify({ notes: value || null }),
          });
          props.onUpdate({ notes: value || null });
        } catch {
          // ignore
        }
      }, 600)
    );
  };

  const handleNotesInput = (value: string) => {
    setNotes(value);
    saveNotes(value);
  };

  const handleClassification = async (cls: Classification) => {
    props.onUpdate({ classification: cls });
    try {
      await api(`/swtcw/episodes/${ep().id}`, {
        method: "PATCH",
        body: JSON.stringify({ classification: cls }),
      });
    } catch {
      props.onUpdate({ classification: ep().classification });
    }
  };

  const handleWatchedToggle = async () => {
    const newVal = !ep().watched;
    props.onUpdate({ watched: newVal });
    try {
      await api(`/swtcw/episodes/${ep().id}`, {
        method: "PATCH",
        body: JSON.stringify({ watched: newVal }),
      });
    } catch {
      props.onUpdate({ watched: ep().watched });
    }
  };

  const toggleCharacter = async (charId: string) => {
    const current = ep().characters;
    const next = current.includes(charId)
      ? current.filter((c) => c !== charId)
      : [...current, charId];
    props.onCharactersChanged(next);
    try {
      await api(`/swtcw/episodes/${ep().id}/characters`, {
        method: "PUT",
        body: JSON.stringify({ character_ids: next }),
      });
    } catch {
      props.onCharactersChanged(current);
    }
  };

  const handleAddCharacter = async () => {
    const name = newCharInput().trim();
    if (!name) return;
    setAddingChar(true);
    setCharError("");
    try {
      const char = await props.onAddCharacter(name);
      setNewCharInput("");
      // Auto-tag on new character creation
      const next = [...ep().characters, char.id];
      props.onCharactersChanged(next);
      await api(`/swtcw/episodes/${ep().id}/characters`, {
        method: "PUT",
        body: JSON.stringify({ character_ids: next }),
      });
    } catch (e: unknown) {
      setCharError(e instanceof Error ? e.message : "Failed to add character");
    } finally {
      setAddingChar(false);
    }
  };

  // Close on Escape
  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  return (
    <>
      {/* Backdrop */}
      <div
        class="fixed inset-0 z-40 bg-black/50 md:bg-transparent"
        onClick={props.onClose}
      />

      {/* Panel — bottom sheet on mobile, right drawer on desktop */}
      <div class="fixed inset-x-0 bottom-0 z-50 md:inset-y-0 md:right-0 md:left-auto md:w-96 flex flex-col bg-zinc-900 border-t border-zinc-800 md:border-t-0 md:border-l rounded-t-2xl md:rounded-none shadow-2xl max-h-[85vh] md:max-h-none overflow-y-auto">
        {/* Header */}
        <div class="flex items-start justify-between px-5 pt-5 pb-4 border-b border-zinc-800 flex-none">
          <div class="flex-1 min-w-0 pr-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-xs text-zinc-500">{posLabel(ep().id)}</span>
              <span class="font-mono text-xs text-zinc-400">{seLabel(ep())}</span>
              <Show when={ep().arc}>
                <span class="px-1.5 py-0.5 rounded text-xs bg-zinc-800 text-zinc-500 border border-zinc-700">
                  {ep().arc}
                </span>
              </Show>
            </div>
            <h3 class="text-base font-semibold text-white leading-snug">{ep().title}</h3>
          </div>
          <button
            onClick={props.onClose}
            class="flex-none p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div class="flex-1 px-5 py-4 flex flex-col gap-5 overflow-y-auto">
          {/* Classification */}
          <div>
            <div class="text-xs text-zinc-500 mb-2 uppercase tracking-wide">Classification</div>
            <Show
              when={props.isOwner}
              fallback={
                <span
                  class={`inline-block px-2 py-1 rounded text-xs font-medium ${classificationColors(ep().classification)}`}
                >
                  {classificationLabel(ep().classification)}
                </span>
              }
            >
              <div class="flex gap-1.5 flex-wrap">
                <For each={CLASSIFICATION_ORDER}>
                  {(cls) => (
                    <button
                      onClick={() => handleClassification(cls)}
                      class={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        ep().classification === cls
                          ? classificationColors(cls)
                          : "bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-zinc-700"
                      }`}
                    >
                      {classificationLabel(cls)}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Characters */}
          <div>
            <div class="text-xs text-zinc-500 mb-2 uppercase tracking-wide">Characters</div>
            <div class="flex flex-wrap gap-1.5">
              <For each={props.characters}>
                {(char) => {
                  const isTagged = () => ep().characters.includes(char.id);
                  return (
                    <Show
                      when={props.isOwner}
                      fallback={
                        <Show when={isTagged()}>
                          <span class="px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-300 border border-zinc-700">
                            {char.name}
                          </span>
                        </Show>
                      }
                    >
                      <button
                        onClick={() => toggleCharacter(char.id)}
                        class={`px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                          isTagged()
                            ? "bg-zinc-700 text-white border border-zinc-600"
                            : "bg-zinc-800/50 text-zinc-500 border border-zinc-700 hover:text-zinc-300 hover:border-zinc-600"
                        }`}
                      >
                        <Show when={isTagged()}>
                          <Check size={10} />
                        </Show>
                        {char.name}
                      </button>
                    </Show>
                  );
                }}
              </For>
            </div>

            {/* Add new character — owner only */}
            <Show when={props.isOwner}>
              <div class="mt-2 flex gap-1.5">
                <input
                  type="text"
                  placeholder="Add new character…"
                  value={newCharInput()}
                  onInput={(e) => setNewCharInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCharacter();
                  }}
                  class="flex-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={handleAddCharacter}
                  disabled={addingChar() || !newCharInput().trim()}
                  class="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors disabled:opacity-40 flex items-center gap-1 text-xs"
                >
                  <Plus size={12} />
                  Add
                </button>
              </div>
              <Show when={charError()}>
                <p class="text-red-400 text-xs mt-1">{charError()}</p>
              </Show>
            </Show>
          </div>

          {/* Watched toggle — owner only */}
          <Show when={props.isOwner}>
            <div>
              <div class="text-xs text-zinc-500 mb-2 uppercase tracking-wide">Watched</div>
              <button
                onClick={handleWatchedToggle}
                class={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  ep().watched
                    ? "bg-emerald-950/60 border-emerald-800 text-emerald-400"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Check size={14} />
                {ep().watched ? "Watched" : "Not watched"}
              </button>
            </div>
          </Show>

          {/* Notes */}
          <div class="flex-1">
            <div class="text-xs text-zinc-500 mb-2 uppercase tracking-wide">Notes</div>
            <Show
              when={props.isOwner}
              fallback={
                <Show when={ep().notes}>
                  <p class="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                    {ep().notes}
                  </p>
                </Show>
              }
            >
              <textarea
                value={notes()}
                onInput={(e) => handleNotesInput(e.currentTarget.value)}
                placeholder="Add notes…"
                rows={5}
                class="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-none leading-relaxed"
              />
            </Show>
          </div>
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Character Management Modal
// ---------------------------------------------------------------------------

const CharacterModal: Component<{
  characters: Character[];
  onClose: () => void;
  onAdded: (char: Character) => void;
  onDeleted: (id: string) => void;
}> = (props) => {
  const [newName, setNewName] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const [addError, setAddError] = createSignal("");
  const [deleteErrors, setDeleteErrors] = createSignal<Record<string, string>>({});
  const [deleting, setDeleting] = createSignal<string | null>(null);

  const handleAdd = async () => {
    const name = newName().trim();
    if (!name) return;
    setAdding(true);
    setAddError("");
    try {
      const char = await api<Character>("/swtcw/characters", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      props.onAdded(char);
      setNewName("");
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add character");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (char: Character) => {
    if (char.episode_count > 0) return;
    setDeleting(char.id);
    setDeleteErrors((prev) => ({ ...prev, [char.id]: "" }));
    try {
      await api(`/swtcw/characters/${char.id}`, { method: "DELETE" });
      props.onDeleted(char.id);
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.message.includes("in use")
          ? `In use by ${char.episode_count} episode(s)`
          : (e instanceof Error ? e.message : "Failed to delete");
      setDeleteErrors((prev) => ({ ...prev, [char.id]: msg }));
    } finally {
      setDeleting(null);
    }
  };

  // Close on Escape
  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  return (
    <>
      <div class="fixed inset-0 z-50 bg-black/60" onClick={props.onClose} />
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div class="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl pointer-events-auto max-h-[80vh] flex flex-col">
          <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-none">
            <h3 class="font-semibold text-white flex items-center gap-2">
              <Tag size={15} />
              Manage Characters
            </h3>
            <button
              onClick={props.onClose}
              class="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-1">
            <For each={props.characters}>
              {(char) => {
                const errMsg = () => deleteErrors()[char.id];
                const isDeleting = () => deleting() === char.id;
                const inUse = () => char.episode_count > 0;
                return (
                  <div class="flex items-center gap-2 py-2 border-b border-zinc-800/50 last:border-0">
                    <span class="flex-1 text-sm text-zinc-200">{char.name}</span>
                    <span class="text-xs text-zinc-600">
                      {char.episode_count > 0
                        ? `${char.episode_count} ep${char.episode_count !== 1 ? "s" : ""}`
                        : ""}
                    </span>
                    <Show when={errMsg()}>
                      <span class="text-xs text-red-400">{errMsg()}</span>
                    </Show>
                    <button
                      onClick={() => handleDelete(char)}
                      disabled={inUse() || isDeleting()}
                      title={
                        inUse()
                          ? `In use by ${char.episode_count} episode(s) — untag first`
                          : "Delete"
                      }
                      class="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              }}
            </For>
          </div>

          <div class="px-5 py-4 border-t border-zinc-800 flex-none">
            <div class="flex gap-2">
              <input
                type="text"
                placeholder="New character name…"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                class="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              />
              <button
                onClick={handleAdd}
                disabled={adding() || !newName().trim()}
                class="px-3 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                <Plus size={14} />
                Add
              </button>
            </div>
            <Show when={addError()}>
              <p class="text-red-400 text-xs mt-2">{addError()}</p>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const SWTCW: Component = () => {
  const isOwner = () => authSignal();

  const [episodes, setEpisodes] = createSignal<Episode[]>([]);
  const [characters, setCharacters] = createSignal<Character[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [selectedEpisode, setSelectedEpisode] = createSignal<Episode | null>(null);
  const [showCharModal, setShowCharModal] = createSignal(false);
  const [shareMsg, setShareMsg] = createSignal("");

  const [params, setParams] = useSearchParams();

  // ---------------------------------------------------------------------------
  // Filter state derived from URL
  // useSearchParams values are `string | string[]` — always coerce to string.
  // ---------------------------------------------------------------------------
  const paramStr = (v: string | string[] | undefined): string => {
    if (!v) return "";
    return Array.isArray(v) ? v[0] ?? "" : v;
  };

  const selectedCls = (): Set<string> => {
    const raw = paramStr(params.cls);
    if (!raw) return new Set();
    return new Set(raw.split(",").filter(Boolean));
  };

  const selectedChars = (): Set<string> => {
    const raw = paramStr(params.char);
    if (!raw) return new Set();
    return new Set(raw.split(",").filter(Boolean));
  };

  const selectedArc = (): string | null => paramStr(params.arc) || null;

  const hideWatched = (): boolean => isOwner() && paramStr(params.hideWatched) === "1";

  const reviewedOnly = (): boolean => paramStr(params.reviewed) === "1";

  const searchQ = (): string => paramStr(params.q);

  const setSearchQ = (q: string) => setParams({ q: q || undefined });

  const toggleCls = (cls: string) => {
    const s = new Set(selectedCls());
    if (s.has(cls)) s.delete(cls);
    else s.add(cls);
    setParams({ cls: s.size ? [...s].join(",") : undefined });
  };

  const toggleChar = (id: string) => {
    const s = new Set(selectedChars());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setParams({ char: s.size ? [...s].join(",") : undefined });
  };

  const setArc = (arc: string | null) =>
    setParams({ arc: arc || undefined });

  const setHideWatched = (v: boolean) =>
    setParams({ hideWatched: v ? "1" : undefined });

  const setReviewedOnly = (v: boolean) =>
    setParams({ reviewed: v ? "1" : undefined });

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------
  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [eps, chars] = await Promise.all([
        api<Episode[]>("/swtcw/episodes"),
        api<Character[]>("/swtcw/characters"),
      ]);
      setEpisodes(eps);
      setCharacters(chars);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load episodes");
    } finally {
      setLoading(false);
    }
  };

  loadData();

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const arcs = createMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ep of episodes()) {
      if (ep.arc && !seen.has(ep.arc)) {
        seen.add(ep.arc);
        result.push(ep.arc);
      }
    }
    return result;
  });

  const watchedCount = createMemo(
    () => episodes().filter((e) => e.watched).length
  );

  const totalCount = createMemo(() => episodes().length || 134);

  const progressPct = createMemo(() =>
    totalCount() > 0 ? (watchedCount() / totalCount()) * 100 : 0
  );

  const filteredEpisodes = createMemo(() => {
    const clsFilter = selectedCls();
    const charFilter = selectedChars();
    const arc = selectedArc();
    const q = searchQ().toLowerCase();
    const hw = hideWatched();
    const ro = reviewedOnly();

    return episodes().filter((ep) => {
      if (hw && ep.watched) return false;
      if (ro && ep.classification === null) return false;

      if (clsFilter.size > 0) {
        const epCls = ep.classification ?? "unreviewed";
        if (!clsFilter.has(epCls)) return false;
      }

      if (charFilter.size > 0) {
        const hasAny = ep.characters.some((c) => charFilter.has(c));
        if (!hasAny) return false;
      }

      if (arc && ep.arc !== arc) return false;

      if (q && !ep.title.toLowerCase().includes(q)) return false;

      return true;
    });
  });

  const anyReviewed = createMemo(() =>
    episodes().some((e) => e.classification !== null)
  );

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const updateEpisode = (id: number, update: Partial<Episode>) => {
    setEpisodes((prev) =>
      prev.map((ep) => (ep.id === id ? { ...ep, ...update } : ep))
    );
    // Sync detail panel
    const current = selectedEpisode();
    if (current && current.id === id) {
      setSelectedEpisode({ ...current, ...update });
    }
  };

  const handleToggleWatched = async (ep: Episode) => {
    const newVal = !ep.watched;
    updateEpisode(ep.id, { watched: newVal });
    try {
      await api(`/swtcw/episodes/${ep.id}`, {
        method: "PATCH",
        body: JSON.stringify({ watched: newVal }),
      });
    } catch {
      updateEpisode(ep.id, { watched: ep.watched });
    }
  };

  const handleCycleClassification = async (ep: Episode) => {
    const next = cycleClassification(ep.classification);
    updateEpisode(ep.id, { classification: next });
    try {
      await api(`/swtcw/episodes/${ep.id}`, {
        method: "PATCH",
        body: JSON.stringify({ classification: next }),
      });
    } catch {
      updateEpisode(ep.id, { classification: ep.classification });
    }
  };

  const handleCharactersChanged = async (ep: Episode, ids: string[]) => {
    updateEpisode(ep.id, { characters: ids });
    try {
      await api(`/swtcw/episodes/${ep.id}/characters`, {
        method: "PUT",
        body: JSON.stringify({ character_ids: ids }),
      });
    } catch {
      updateEpisode(ep.id, { characters: ep.characters });
    }
  };

  const handleAddCharacter = async (name: string): Promise<Character> => {
    const char = await api<Character>("/swtcw/characters", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setCharacters((prev) => [...prev, char]);
    return char;
  };

  const handleCharacterAdded = (char: Character) => {
    setCharacters((prev) => {
      const exists = prev.some((c) => c.id === char.id);
      return exists ? prev : [...prev, char];
    });
  };

  const handleCharacterDeleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareMsg("Copied!");
      setTimeout(() => setShareMsg(""), 2000);
    } catch {
      setShareMsg("Copy failed");
      setTimeout(() => setShareMsg(""), 2000);
    }
  };

  // ---------------------------------------------------------------------------
  // Filter bar pill helpers
  // ---------------------------------------------------------------------------
  const clsOptions = [
    { id: "essential", label: "Essential" },
    { id: "lore_light", label: "Lore-Light" },
    { id: "filler", label: "Filler" },
  ] as const;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div class="flex flex-col min-h-0 h-full">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div class="flex-none mb-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 class="text-xl font-bold text-white leading-tight">
              Clone Wars Watch Order
            </h2>
            <p class="text-sm text-zinc-500 mt-0.5">
              Star Wars: The Clone Wars — chronological order
            </p>
          </div>
          <button
            onClick={handleShare}
            class="flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 border border-zinc-700 transition-colors"
          >
            <Share2 size={14} />
            {shareMsg() || "Share"}
          </button>
        </div>

        {/* Progress strip */}
        <div class="flex items-center gap-3">
          <div class="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-emerald-600 rounded-full transition-all duration-500"
              style={{ width: `${progressPct()}%` }}
            />
          </div>
          <span class="flex-none text-xs text-zinc-500 tabular-nums">
            {watchedCount()} / {totalCount()} watched
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filter bar                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div class="flex-none mb-3 flex flex-col gap-2">
        {/* Search row */}
        <div class="flex items-center gap-2">
          <div class="flex-1 relative">
            <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search episodes…"
              value={searchQ()}
              onInput={(e) => setSearchQ(e.currentTarget.value)}
              class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
            />
          </div>

          {/* Reviewed only toggle */}
          <button
            onClick={() => setReviewedOnly(!reviewedOnly())}
            class={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
              reviewedOnly()
                ? "bg-zinc-700 text-white border-zinc-600"
                : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
            }`}
          >
            Reviewed
          </button>

          {/* Hide watched — owner only */}
          <Show when={isOwner()}>
            <button
              onClick={() => setHideWatched(!hideWatched())}
              class={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
                hideWatched()
                  ? "bg-zinc-700 text-white border-zinc-600"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
              }`}
            >
              Hide watched
            </button>
          </Show>
        </div>

        {/* Classification pills */}
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="flex-none text-xs text-zinc-600">Classification:</span>
          <For each={clsOptions}>
            {(opt) => {
              const active = () => selectedCls().has(opt.id);
              return (
                <button
                  onClick={() => toggleCls(opt.id)}
                  class={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    active()
                      ? opt.id === "essential"
                        ? "bg-emerald-950/70 text-emerald-400 border-emerald-800"
                        : opt.id === "lore_light"
                        ? "bg-amber-950/70 text-amber-400 border-amber-800"
                        : opt.id === "filler"
                        ? "bg-rose-950/70 text-rose-400 border-rose-900"
                        : "bg-zinc-700 text-zinc-400 border-zinc-600"
                      : "bg-zinc-900 text-zinc-600 border-zinc-800 hover:text-zinc-400"
                  }`}
                >
                  {opt.label}
                </button>
              );
            }}
          </For>
        </div>

        {/* Character chips — horizontal scroll */}
        <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          <span class="flex-none text-xs text-zinc-600">Characters:</span>
          <For each={characters()}>
            {(char) => {
              const active = () => selectedChars().has(char.id);
              return (
                <button
                  onClick={() => toggleChar(char.id)}
                  class={`flex-none px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    active()
                      ? "bg-zinc-700 text-white border-zinc-600"
                      : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
                  }`}
                >
                  {char.name}
                </button>
              );
            }}
          </For>

          {/* Manage tags — owner only */}
          <Show when={isOwner()}>
            <button
              onClick={() => setShowCharModal(true)}
              class="flex-none px-2.5 py-1 rounded-lg text-xs font-medium border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700 transition-colors flex items-center gap-1"
            >
              <Tag size={11} />
              Manage tags
            </button>
          </Show>
        </div>

        {/* Arc filter */}
        <Show when={arcs().length > 0}>
          <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            <span class="flex-none text-xs text-zinc-600">Arc:</span>
            <button
              onClick={() => setArc(null)}
              class={`flex-none px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                !selectedArc()
                  ? "bg-zinc-700 text-white border-zinc-600"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
              }`}
            >
              All
            </button>
            <For each={arcs()}>
              {(arc) => (
                <button
                  onClick={() => setArc(selectedArc() === arc ? null : arc)}
                  class={`flex-none px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    selectedArc() === arc
                      ? "bg-zinc-700 text-white border-zinc-600"
                      : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
                  }`}
                >
                  {arc}
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Active filters summary */}
        <Show
          when={
            selectedCls().size > 0 ||
            selectedChars().size > 0 ||
            selectedArc() ||
            hideWatched() ||
            reviewedOnly() ||
            searchQ()
          }
        >
          <div class="flex items-center gap-2">
            <span class="text-xs text-zinc-600">
              {filteredEpisodes().length} of {episodes().length} episodes
            </span>
            <button
              onClick={() =>
                setParams({
                  cls: undefined,
                  char: undefined,
                  arc: undefined,
                  hideWatched: undefined,
                  reviewed: undefined,
                  q: undefined,
                })
              }
              class="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
            >
              <X size={11} />
              Clear filters
            </button>
          </div>
        </Show>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Episode list                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div class="flex-1 overflow-auto min-h-0">
        {/* Loading state */}
        <Show when={loading()}>
          <div class="flex flex-col gap-1.5">
            <For each={Array.from({ length: 10 })}>
              {() => (
                <div class="h-10 rounded-lg bg-zinc-900 animate-pulse" />
              )}
            </For>
          </div>
        </Show>

        {/* Error state */}
        <Show when={error() && !loading()}>
          <div class="rounded-lg bg-red-950/50 border border-red-800 px-4 py-3 text-red-400 text-sm flex items-center justify-between">
            <span>{error()}</span>
            <button
              onClick={loadData}
              class="text-red-300 hover:text-red-100 underline text-xs"
            >
              Retry
            </button>
          </div>
        </Show>

        {/* Intro card — when no episodes are reviewed yet */}
        <Show when={!loading() && !error() && !anyReviewed()}>
          <div class="mb-4 px-4 py-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 leading-relaxed">
            <Show
              when={isOwner()}
              fallback={
                <p>
                  Asher is rewatching{" "}
                  <span class="text-zinc-300 font-medium">
                    Star Wars: The Clone Wars
                  </span>{" "}
                  in chronological order. Episodes will be tagged here as he
                  watches — pick a character or filter to filler-free to plan
                  your own watch.
                </p>
              }
            >
              <p>
                Welcome! Start by marking episodes as you watch them and
                classifying them — friends can filter your watch guide by
                classification or character.
              </p>
            </Show>
          </div>
        </Show>

        {/* Episode rows */}
        <Show when={!loading() && !error()}>
          <div class="flex flex-col">
            <For each={filteredEpisodes()}>
              {(ep) => (
                <EpisodeRow
                  episode={ep}
                  characters={characters()}
                  isOwner={isOwner()}
                  onToggleWatched={() => handleToggleWatched(ep)}
                  onCycleClassification={() =>
                    handleCycleClassification(ep)
                  }
                  onOpenDetail={() => setSelectedEpisode(ep)}
                  onCharactersChanged={(ids) =>
                    handleCharactersChanged(ep, ids)
                  }
                />
              )}
            </For>

            {/* Empty filtered result */}
            <Show when={filteredEpisodes().length === 0 && episodes().length > 0}>
              <div class="py-12 text-center">
                <p class="text-zinc-600 text-sm">No episodes match your filters.</p>
                <button
                  onClick={() =>
                    setParams({
                      cls: undefined,
                      char: undefined,
                      arc: undefined,
                      hideWatched: undefined,
                      reviewed: undefined,
                      q: undefined,
                    })
                  }
                  class="mt-2 text-xs text-zinc-500 hover:text-zinc-300 underline"
                >
                  Clear filters
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Detail panel                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Show when={selectedEpisode()}>
        {(ep) => (
          <DetailPanel
            episode={ep()}
            characters={characters()}
            isOwner={isOwner()}
            onClose={() => setSelectedEpisode(null)}
            onUpdate={(update) => updateEpisode(ep().id, update)}
            onCharactersChanged={(ids) => updateEpisode(ep().id, { characters: ids })}
            onAddCharacter={handleAddCharacter}
          />
        )}
      </Show>

      {/* ------------------------------------------------------------------ */}
      {/* Character management modal                                           */}
      {/* ------------------------------------------------------------------ */}
      <Show when={showCharModal() && isOwner()}>
        <CharacterModal
          characters={characters()}
          onClose={() => setShowCharModal(false)}
          onAdded={handleCharacterAdded}
          onDeleted={handleCharacterDeleted}
        />
      </Show>
    </div>
  );
};

export default SWTCW;
