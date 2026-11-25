import type { CaseFile, Granularity, MergeAnalysis, SensitiveCacheEntry } from '../types';
import type { WorkerResponse } from './sync.worker';

// 单例 Worker 与请求/响应匹配。若 Worker 实例化失败（极少数受限环境），
// 回退到主线程直接计算，保证功能仍可复现。
let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (a: MergeAnalysis) => void; reject: (e: Error) => void }>();
const expiryListeners = new Set<(entries: SensitiveCacheEntry[]) => void>();

function ensureWorker(): Worker | null {
  if (failed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./sync.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'merge-result') {
        pending.get(msg.reqId)?.resolve(msg.analysis);
        pending.delete(msg.reqId);
      } else if (msg.type === 'merge-error') {
        pending.get(msg.reqId)?.reject(new Error(msg.message));
        pending.delete(msg.reqId);
      } else if (msg.type === 'secrets-expired') {
        expiryListeners.forEach((fn) => fn(msg.entries));
      }
    };
    worker.onerror = () => {
      failed = true;
    };
    return worker;
  } catch {
    failed = true;
    return null;
  }
}

export function onSecretsExpired(fn: (entries: SensitiveCacheEntry[]) => void): () => void {
  expiryListeners.add(fn);
  return () => expiryListeners.delete(fn);
}

export function requestPurgeNow(): void {
  ensureWorker()?.postMessage({ type: 'purge-now' });
}

export async function runMerge(
  caseId: string,
  base: CaseFile,
  local: CaseFile,
  remote: CaseFile,
  granularity: Granularity,
): Promise<MergeAnalysis> {
  const w = ensureWorker();
  if (!w) {
    const { analyzeMerge } = await import('../lib/merge');
    return analyzeMerge(caseId, base, local, remote, granularity);
  }
  const reqId = ++seq;
  return new Promise<MergeAnalysis>((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    w.postMessage({ type: 'merge', reqId, caseId, base, local, remote, granularity });
  });
}
