import { create } from "zustand";
import { audioUrl } from "@shared/types.js";

/**
 * One player for the whole history list (§13 Phase 6).
 *
 * A hundred rows means a hundred <audio> elements if each row owns its own,
 * and Chromium will happily start decoding several at once. There is exactly
 * one element here, it lives outside React, and rows subscribe to which id it
 * is currently bound to.
 *
 * It is created lazily rather than at module load: a user who never plays
 * anything should not have an audio element in their document at all.
 */

export interface PlayerState {
  /** The dictation currently loaded, playing or paused. Null when idle. */
  id: number | null;
  playing: boolean;
  /** Seconds. `duration` is NaN until metadata arrives, so it is nullable here. */
  elapsed: number;
  duration: number | null;
  /** Set when the source will not load — a row whose file went missing. */
  failed: boolean;
}

interface PlayerActions {
  toggle(id: number): void;
  stop(): void;
  /** Called when a row is deleted, so the player does not hold a dead source. */
  release(id: number): void;
}

let el: HTMLAudioElement | null = null;

/**
 * The renderer names an ID, never a path (§6.8). The URL shape comes from
 * shared/types.ts so it cannot drift from what the handler parses.
 */
const sourceFor = (id: number) => audioUrl(id);

function audio(): HTMLAudioElement {
  if (el) return el;

  const node = new Audio();
  node.preload = "metadata";

  const set = usePlayer.setState;

  node.addEventListener("play", () => set({ playing: true, failed: false }));
  node.addEventListener("pause", () => set({ playing: false }));
  node.addEventListener("timeupdate", () => set({ elapsed: node.currentTime }));
  node.addEventListener("loadedmetadata", () =>
    // A WAV served without a Content-Length can report Infinity here; treat
    // anything non-finite as "unknown" rather than rendering "Infinity".
    set({ duration: Number.isFinite(node.duration) ? node.duration : null }),
  );
  node.addEventListener("ended", () =>
    set({ playing: false, elapsed: 0, id: null }),
  );
  // Fires when the protocol handler 404s — the row outlived its file.
  node.addEventListener("error", () =>
    set({ playing: false, failed: true, id: null }),
  );

  return (el = node);
}

export const usePlayer = create<PlayerState & PlayerActions>((set, get) => ({
  id: null,
  playing: false,
  elapsed: 0,
  duration: null,
  failed: false,

  toggle(id) {
    const node = audio();
    const current = get();

    // Same row: pause and resume in place, keeping the position.
    if (current.id === id) {
      if (current.playing) node.pause();
      else void node.play().catch(() => set({ failed: true, playing: false }));
      return;
    }

    // Different row: starting a second recording stops the first (§13).
    node.pause();
    node.src = sourceFor(id);
    node.currentTime = 0;

    set({ id, playing: false, elapsed: 0, duration: null, failed: false });
    void node.play().catch(() => set({ failed: true, playing: false }));
  },

  stop() {
    el?.pause();
    if (el) el.removeAttribute("src");
    set({ id: null, playing: false, elapsed: 0, duration: null });
  },

  release(id) {
    if (get().id === id) get().stop();
  },
}));
