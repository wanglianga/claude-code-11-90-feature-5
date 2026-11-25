// IndexedDB 库名 / 键约定。WebWorker 与主线程共用。

export const REMOTE_DB = 'casedesk_remote_v1';
export const LOCAL_DB = 'casedesk_local_v1';
export const DB_VERSION = 1;

export const BUS_CHANNEL = 'casedesk_bus_v1';

export function secretCacheKey(actorId: string, caseId: string): string {
  return `${actorId}:${caseId}:client.emergencyContact`;
}

export function draftKey(tabId: string, caseId: string): string {
  return `${tabId}:${caseId}`;
}
