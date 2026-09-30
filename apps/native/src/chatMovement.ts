import type {ChatMessageOrder} from './chatRows';

export type StreamingMovement = {settle: number; trigger: number};
export const defaultMovement: StreamingMovement = {settle: 75, trigger: 100};

export function parseMovement(value: unknown): StreamingMovement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultMovement;
  const settle: unknown = Reflect.get(value, 'settle');
  const trigger: unknown = Reflect.get(value, 'trigger');
  if (typeof settle !== 'number' || typeof trigger !== 'number' || !Number.isInteger(settle) || !Number.isInteger(trigger) || settle % 5 || trigger % 5
    || settle < 25 || settle > 90 || trigger < 35 || trigger > 100 || trigger - settle < 10) return defaultMovement;
  return {settle, trigger};
}

export function moveHandle(current: StreamingMovement, handle: keyof StreamingMovement, raw: number): StreamingMovement {
  if (!Number.isFinite(raw)) return current;
  const value = Math.round(raw / 5) * 5;
  return handle === 'settle'
    ? {settle: Math.min(90, current.trigger - 10, Math.max(25, value)), trigger: current.trigger}
    : {settle: current.settle, trigger: Math.max(35, current.settle + 10, Math.min(100, value))};
}

export function followTarget({height, contentHeight, edgeBottom, offset, streaming, following, order, movement, force = false}: {
  height: number; contentHeight: number; edgeBottom: number; offset: number; streaming: boolean; following: boolean;
  order: ChatMessageOrder; movement: StreamingMovement; force?: boolean;
}): number | null {
  if (!following || height <= 0) return null;
  const max = Math.max(0, contentHeight - height);
  if (!streaming) return order === 'newest-first' ? 0 : max;
  if (!force && edgeBottom - offset <= height * movement.trigger / 100 + 0.5) return null;
  return Math.max(0, Math.min(max, edgeBottom - height * movement.settle / 100));
}
