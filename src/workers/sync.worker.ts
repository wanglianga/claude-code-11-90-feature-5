/// <reference lib="webworker" />
import { analyzeMerge } from '../lib/merge';
import { purgeExpiredSecrets } from '../db/localDb';
import type { CaseFile, Granularity, MergeAnalysis, SensitiveCacheEntry } from '../types';

// 同步引擎 Worker：
// 1) 在后台线程执行三方合并分析，避免大文档比较阻塞输入；
// 2) 定时清扫已过 expiresAt 的受限字段持久缓存 —— 即使设备完全离线也会执行。

const ctx = self as unknown as DedicatedWorkerGlobalScope;

export type WorkerRequest =
  | {
      type: 'merge';
      reqId: number;
      caseId: string;
      base: CaseFile;
      local: CaseFile;
      remote: CaseFile;
      granularity: Granularity;
    }
  | { type: 'purge-now' };

export type WorkerResponse =
  | { type: 'merge-result'; reqId: number; analysis: MergeAnalysis }
  | { type: 'merge-error'; reqId: number; message: string }
  | { type: 'secrets-expired'; entries: SensitiveCacheEntry[] };

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'merge') {
    try {
      // 极低优先级让输入事件先响应；比较本身是同步纯函数
      await new Promise((r) => setTimeout(r, 30));
      const analysis = analyzeMerge(
        msg.caseId,
        msg.base,
        msg.local,
        msg.remote,
        msg.granularity,
      );
      const res: WorkerResponse = { type: 'merge-result', reqId: msg.reqId, analysis };
      ctx.postMessage(res);
    } catch (err) {
      const res: WorkerResponse = {
        type: 'merge-error',
        reqId: msg.reqId,
        message: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(res);
    }
    return;
  }
  if (msg.type === 'purge-now') {
    const expired = await safePurge();
    if (expired.length) {
      const res: WorkerResponse = { type: 'secrets-expired', entries: expired };
      ctx.postMessage(res);
    }
  }
};

async function safePurge(): Promise<SensitiveCacheEntry[]> {
  try {
    return await purgeExpiredSecrets(Date.now());
  } catch {
    return [];
  }
}

// 每 4 秒检查一次到期凭据。到期后无需网络即可删除持久缓存并通知界面遮蔽。
setInterval(() => {
  void safePurge().then((expired) => {
    if (expired.length) {
      const res: WorkerResponse = { type: 'secrets-expired', entries: expired };
      ctx.postMessage(res);
    }
  });
}, 4000);
