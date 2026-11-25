import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AuditEntry, CaseFile, FieldGrant } from '../types';
import { DB_VERSION, REMOTE_DB } from './schema';

export interface HistoryRecord {
  hid: string; // `${caseId}@${rev}`
  caseId: string;
  rev: number;
  at: number;
  actorName: string;
  snapshot: CaseFile;
}

interface RemoteSchema extends DBSchema {
  cases: { key: string; value: CaseFile };
  grants: { key: string; value: FieldGrant };
  audit: {
    key: string;
    value: AuditEntry;
    indexes: { byCase: string; at: number };
  };
  history: { key: string; value: HistoryRecord; indexes: { byCase: string } };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<RemoteSchema>> | null = null;

export function remoteDb(): Promise<IDBPDatabase<RemoteSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<RemoteSchema>(REMOTE_DB, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('cases', { keyPath: 'id' });
        db.createObjectStore('grants', { keyPath: 'id' });
        const audit = db.createObjectStore('audit', { keyPath: 'id' });
        audit.createIndex('byCase', 'caseId');
        audit.createIndex('at', 'at');
        const hist = db.createObjectStore('history', { keyPath: 'hid' });
        hist.createIndex('byCase', 'caseId');
        db.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

export async function remoteKvGet<T>(key: string): Promise<T | undefined> {
  const db = await remoteDb();
  return (await db.get('kv', key)) as T | undefined;
}

export async function remoteKvSet(key: string, value: unknown): Promise<void> {
  const db = await remoteDb();
  await db.put('kv', value, key);
}
