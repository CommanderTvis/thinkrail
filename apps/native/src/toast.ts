import {useSyncExternalStore} from 'react';

export type Toast = {id: number; variant: 'error' | 'success' | 'info'; title?: string; message: string};

const AUTO_DISMISS_MS = 5000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
const snapshot = () => toasts;

function publish(next: Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  publish(toasts.filter(item => item.id !== id));
}

function push(variant: Toast['variant'], message: string, title?: string) {
  const id = nextId++;
  publish([...toasts, {id, variant, message, ...(title ? {title} : {})}]);
  if (variant !== 'error') setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
}

export const toast = {
  error: (message: string, title?: string) => push('error', message, title),
  success: (message: string, title?: string) => push('success', message, title),
  info: (message: string, title?: string) => push('info', message, title),
};

export const useToasts = () => useSyncExternalStore(subscribe, snapshot);
