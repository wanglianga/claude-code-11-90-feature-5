import type { TabPresence } from '../types';
import { BUS_CHANNEL } from '../db/schema';

export type BusMessage =
  | { type: 'remote-changed'; caseId: string; rev: number; at: number; actorName: string }
  | { type: 'audit-added' }
  | { type: 'grants-changed'; caseId?: string }
  | { type: 'grant-revoked'; grantId: string; caseId: string; at: number }
  | { type: 'data-reset'; at: number }
  | { type: 'presence'; presence: TabPresence }
  | { type: 'presence-bye'; tabId: string };

let channel: BroadcastChannel | null = null;

function ch(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(BUS_CHANNEL);
  return channel;
}

export function emit(msg: BusMessage): void {
  const c = ch();
  c?.postMessage(msg);
}

export function onMessage(handler: (msg: BusMessage) => void): () => void {
  const c = ch();
  if (!c) return () => {};
  const listener = (e: MessageEvent<BusMessage>) => handler(e.data);
  c.addEventListener('message', listener);
  return () => c.removeEventListener('message', listener);
}
