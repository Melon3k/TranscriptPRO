import { create } from "zustand";

export type NotifyKind = "success" | "error" | "info";

export interface Banner {
  kind: NotifyKind;
  message: string;
}

interface NotifyState {
  banner: Banner | null;
  /** Show a transient banner. Auto-dismiss is handled by the Banner component. */
  notify: (kind: NotifyKind, message: string) => void;
  dismiss: () => void;
}

/**
 * Global transient notification banner (success / error / info), mirroring the
 * imported design's top banner. Panels push through here instead of each
 * rendering their own toast, so the shell owns a single dismissable strip.
 */
export const useNotifyStore = create<NotifyState>((set) => ({
  banner: null,
  notify: (kind, message) => set({ banner: { kind, message } }),
  dismiss: () => set({ banner: null }),
}));
