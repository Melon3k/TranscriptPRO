import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "done"
  | "error"
  | "up-to-date";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  update: Update | null;
  contentLength: number | null;
  downloaded: number;
  error: string | null;
  dismissedVersion: string | null;

  setChecking: () => void;
  setAvailable: (update: Update) => void;
  setUpToDate: () => void;
  setDownloading: (contentLength: number | null) => void;
  addProgress: (chunk: number) => void;
  setInstalling: () => void;
  setDone: () => void;
  setError: (message: string) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  update: null,
  contentLength: null,
  downloaded: 0,
  error: null,
  dismissedVersion: null,

  setChecking: () => set({ status: "checking", error: null }),

  setAvailable: (update) =>
    set({
      status: "available",
      update,
      version: update.version,
      notes: update.body ?? null,
      error: null,
      downloaded: 0,
      contentLength: null,
    }),

  setUpToDate: () =>
    set({
      status: "up-to-date",
      update: null,
      version: null,
      notes: null,
      error: null,
    }),

  setDownloading: (contentLength) =>
    set({ status: "downloading", contentLength, downloaded: 0, error: null }),

  addProgress: (chunk) => set({ downloaded: get().downloaded + chunk }),

  setInstalling: () => set({ status: "installing" }),

  setDone: () => set({ status: "done" }),

  setError: (message) => set({ status: "error", error: message }),

  dismiss: () => {
    const v = get().version;
    set({ dismissedVersion: v, status: "idle" });
  },

  reset: () =>
    set({
      status: "idle",
      version: null,
      notes: null,
      update: null,
      contentLength: null,
      downloaded: 0,
      error: null,
    }),
}));
