import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DraftEnvelope, OutboxOp, SensitiveCacheEntry } from '../types';
import { DB_VERSION, LOCAL_DB, draftKey } from './schema';

export interface DraftRecord extends DraftEnvelope {
  key: string; // `${tabId}:${caseId}`
}

interface LocalSchema extends DBSchema {
  drafts: { key: string; value: DraftRecord; indexes: { byTab: string } };
  outbox: { key: string; value: OutboxOp; indexes: { byCase: string; status: string } };
  sensitive: { key: string; value: SensitiveCacheEntry };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<LocalSchema>> | null = null;

export function localDb(): Promise<IDBPDatabase<LocalSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<LocalSchema>(LOCAL_DB, DB_VERSION, {
      upgrade(db) {
        const drafts = db.createObjectStore('drafts', { keyPath: 'key' });
        drafts.createIndex('byTab', 'tabId');
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        outbox.createIndex('byCase', 'caseId');
        outbox.createIndex('status', 'status');
        db.createObjectStore('sensitive', { keyPath: 'cacheKey' });
        db.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

// ---------- 草稿（按标签页隔离，避免两个标签页互相覆盖） ----------

export async function loadDraft(
  tabId: string,
  caseId: string,
): Promise<DraftEnvelope | undefined> {
  const db = await localDb();
  const rec = await db.get('drafts', draftKey(tabId, caseId));
  return rec ? stripKey(rec) : undefined;
}

export async function saveDraft(draft: DraftEnvelope): Promise<void> {
  const db = await localDb();
  const rec: DraftRecord = { ...draft, key: draftKey(draft.tabId, draft.caseId) };
  await db.put('drafts', rec);
}

export async function deleteDraft(tabId: string, caseId: string): Promise<void> {
  const db = await localDb();
  await db.delete('drafts', draftKey(tabId, caseId));
}

function stripKey(rec: DraftRecord): DraftEnvelope {
  const { key: _key, ...env } = rec;
  return env;
}

// ---------- outbox ----------

export async function addOp(op: OutboxOp): Promise<void> {
  const db = await localDb();
  await db.put('outbox', op);
}

export async function updateOp(op: OutboxOp): Promise<void> {
  const db = await localDb();
  await db.put('outbox', op);
}

export async function listOps(): Promise<OutboxOp[]> {
  const db = await localDb();
  const all = await db.getAll('outbox');
  return all.sort((a, b) => b.at - a.at);
}

export async function opsForCase(caseId: string): Promise<OutboxOp[]> {
  const db = await localDb();
  return db.getAllFromIndex('outbox', 'byCase', caseId);
}

// ---------- 受限字段敏感缓存（必须与 expiresAt / grantId 绑定） ----------

export async function putSecret(entry: SensitiveCacheEntry): Promise<void> {
  const db = await localDb();
  await db.put('sensitive', entry);
}

export async function getSecret(cacheKey: string): Promise<SensitiveCacheEntry | undefined> {
  const db = await localDb();
  return db.get('sensitive', cacheKey);
}

export async function allSecrets(): Promise<SensitiveCacheEntry[]> {
  const db = await localDb();
  return db.getAll('sensitive');
}

export async function deleteSecret(cacheKey: string): Promise<void> {
  const db = await localDb();
  await db.delete('sensitive', cacheKey);
}

export async function deleteSecretsByGrant(grantId: string): Promise<string[]> {
  const db = await localDb();
  const all = await db.getAll('sensitive');
  const removed: string[] = [];
  const tx = db.transaction('sensitive', 'readwrite');
  for (const s of all) {
    if (s.grantId === grantId) {
      await tx.store.delete(s.cacheKey);
      removed.push(s.cacheKey);
    }
  }
  await tx.done;
  return removed;
}

/** 到期清扫：即使完全离线，只要 expiresAt <= now 就删除持久缓存 */
export async function purgeExpiredSecrets(now: number): Promise<SensitiveCacheEntry[]> {
  const db = await localDb();
  const all = await db.getAll('sensitive');
  const expired = all.filter((s) => s.expiresAt <= now);
  if (expired.length) {
    const tx = db.transaction('sensitive', 'readwrite');
    for (const s of expired) await tx.store.delete(s.cacheKey);
    await tx.done;
  }
  return expired;
}

export async function clearAllLocalData(): Promise<void> {
  const db = await localDb();
  await db.clear('drafts');
  await db.clear('outbox');
  await db.clear('sensitive');
  await db.clear('kv');
}
