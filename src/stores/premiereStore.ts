import { create } from "zustand";

export type PremiereStatus = "idle" | "server-running" | "plugin-connected";

interface PremiereStore {
  status: PremiereStatus;
  lastError: string | null;
  setStatus: (status: PremiereStatus) => void;
  setError: (error: string | null) => void;
}

export const usePremiereStore = create<PremiereStore>((set) => ({
  status: "idle",
  lastError: null,
  setStatus: (status) => set({ status }),
  setError: (lastError) => set({ lastError }),
}));
