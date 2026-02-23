import { writable } from 'svelte/store';

export type PanelMode = 'chat' | 'terminal';

interface PanelState {
  open: boolean;
  mode: PanelMode;
}

function createPanelStore() {
  const { subscribe, set, update } = writable<PanelState>({
    open: false,
    mode: 'terminal',
  });

  return {
    subscribe,
    open: (mode?: PanelMode) =>
      update((s) => ({ ...s, open: true, mode: mode ?? s.mode })),
    close: () => update((s) => ({ ...s, open: false })),
    toggle: () => update((s) => ({ ...s, open: !s.open })),
    setMode: (mode: PanelMode) => update((s) => ({ ...s, mode })),
  };
}

export const panel = createPanelStore();
