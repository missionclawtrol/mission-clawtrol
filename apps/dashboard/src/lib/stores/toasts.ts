// Toast notification store
import { writable } from 'svelte/store';

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number; // in milliseconds, default 5000
  timestamp: number;
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  return {
    subscribe,
    add: (toast: Omit<Toast, 'id' | 'timestamp'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = Date.now();
      const duration = toast.duration || 5000;

      const newToast: Toast = {
        ...toast,
        id,
        timestamp,
        duration,
      };

      update(toasts => [...toasts, newToast]);

      // Auto-dismiss after duration
      setTimeout(() => {
        update(toasts => toasts.filter(t => t.id !== id));
      }, duration);

      return id;
    },
    remove: (id: string) => {
      update(toasts => toasts.filter(t => t.id !== id));
    },
    clear: () => {
      update(() => []);
    },
  };
}

export const toasts = createToastStore();
