import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allSecrets,
  deleteSecretsByGrant,
  purgeExpiredSecrets,
  putSecret,
  clearAllLocalData,
} from '../src/db/localDb';
import type { SensitiveCacheEntry } from '../src/types';

function secret(over: Partial<SensitiveCacheEntry>): SensitiveCacheEntry {
  return {
    cacheKey: over.cacheKey!,
    caseId: 'case-chen',
    field: 'client.emergencyContact',
    value: { name: '陈志强', relation: '侄子', phone: '139' },
    grantId: 'g-default',
    expiresAt: 2000,
    cachedAt: 0,
    ...over,
  };
}

beforeEach(async () => {
  await clearAllLocalData();
});

describe('受限字段持久缓存的到期与撤权清除', () => {
  it('purgeExpiredSecrets 即使“离线”也删除所有 expiresAt<=now 的条目', async () => {
    await putSecret(secret({ cacheKey: 'lin:case-chen:c', grantId: 'g1', expiresAt: 1000 }));
    await putSecret(secret({ cacheKey: 'zhou:case-chen:c', grantId: 'g2', expiresAt: 5000 }));

    const removed = await purgeExpiredSecrets(3000);
    expect(removed).toHaveLength(1);
    expect(removed[0].grantId).toBe('g1');

    const left = await allSecrets();
    expect(left).toHaveLength(1);
    expect(left[0].grantId).toBe('g2');

    // 到 5000 之后也被清除
    const removed2 = await purgeExpiredSecrets(5000);
    expect(removed2).toHaveLength(1);
    expect(await allSecrets()).toHaveLength(0);
  });

  it('deleteSecretsByGrant 按撤权消息删除对应凭据缓存', async () => {
    await putSecret(secret({ cacheKey: 'a:case-chen:c', grantId: 'gx' }));
    await putSecret(secret({ cacheKey: 'b:case-li:c', caseId: 'case-li', grantId: 'gy' }));
    const keys = await deleteSecretsByGrant('gx');
    expect(keys).toEqual(['a:case-chen:c']);
    const left = await allSecrets();
    expect(left).toHaveLength(1);
    expect(left[0].grantId).toBe('gy');
  });
});
