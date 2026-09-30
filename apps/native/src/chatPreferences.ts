import {useSyncExternalStore} from 'react';
import {Settings} from 'react-native-macos';
import type {ChatMessageOrder} from './chatRows';
import {defaultMovement, parseMovement, type StreamingMovement} from './chatMovement';

let key = '';
let preferences: {order: ChatMessageOrder; movement: StreamingMovement} = {order: 'oldest-first', movement: defaultMovement};
const listeners = new Set<() => void>();
const snapshot = () => preferences;
const subscribe = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
function update(next: typeof preferences) {
  if (next.order === preferences.order && next.movement.settle === preferences.movement.settle && next.movement.trigger === preferences.movement.trigger) return;
  preferences = next;
  for (const listener of listeners) listener();
}

export function initChatPreferences(hostURL: string) {
  key = hostURL;
  update({order: Settings.get(`thinkrail.chat-message-order:${key}`) === 'newest-first' ? 'newest-first' : 'oldest-first',
    movement: parseMovement(Settings.get(`thinkrail.streaming-response-movement:${key}`))});
}

export function setChatMessageOrder(next: ChatMessageOrder) {
  if (!key) return;
  Settings.set({[`thinkrail.chat-message-order:${key}`]: next});
  update({...preferences, order: next});
}

export function setStreamingMovement(next: StreamingMovement) {
  if (!key) return;
  Settings.set({[`thinkrail.streaming-response-movement:${key}`]: next});
  update({...preferences, movement: next});
}

export const useChatMessageOrder = () => useSyncExternalStore(subscribe, snapshot).order;
export const useStreamingMovement = () => useSyncExternalStore(subscribe, snapshot).movement;
