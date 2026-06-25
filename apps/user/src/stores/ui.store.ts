import { create } from 'zustand';

/** Controls the bottom-sheet login drawer (login is not a separate page). */
interface UiState {
  loginOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  loginOpen: false,
  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
}));
