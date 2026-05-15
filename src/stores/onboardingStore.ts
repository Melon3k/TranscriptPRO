import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OnboardingState {
  completed: boolean;
  markComplete: () => void;
}

// If the user already has settings persisted (app update / reinstall scenario),
// skip the wizard on first hydration so it doesn't re-show for existing users.
const hasExistingSettings =
  typeof window !== "undefined" &&
  localStorage.getItem("transcriptpro-settings") !== null;

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: hasExistingSettings,
      markComplete: () => set({ completed: true }),
    }),
    { name: "transcriptpro-onboarding" }
  )
);
