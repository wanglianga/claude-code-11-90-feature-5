import { describe, expect, it } from 'vitest';
import { applyPendingVerificationFix, grantState, validateCandidate } from '../src/lib/rules';
import { chenCase } from '../src/data/seed';
import type { FieldGrant } from '../src/types';

describe('授权凭据状态', () => {
  const now = 1_000_000_000_000;
  const base: FieldGrant = {
    id: 'g1',
    caseId: 'case-chen',
    field: 'client.emergencyContact',
    granteeActorId: 'lin',
    granteeName: '林晓',
    reason: 'test',
    issuedAt: now - 1000,
    expiresAt: now + 30_000,
    ttlLabel: '30 秒',
    revoked: false,
  };

  it('有效 / 到期 / 撤回三态', () => {
    expect(grantState(base, now)).toBe('valid');
    expect(grantState(base, now + 30_001)).toBe('expired');
    expect(grantState({ ...base, revoked: true }, now)).toBe('revoked');
    expect(grantState(undefined, now)).toBe('none');
  });

  it('候选携带紧急联系人真值时，过期/撤权授权一律拦截（即使选本地值）', () => {
    const c = chenCase();
    c.client.emergencyContact = { name: 'x', relation: 'r', phone: '139-0000-0000' };

    const expired = validateCandidate(c, {
      now,
      actorId: 'lin',
      grants: [{ ...base, expiresAt: now - 1 }],
    });
    expect(expired.some((v) => v.code === 'GRANT_EXPIRED')).toBe(true);

    const revoked = validateCandidate(c, {
      now,
      actorId: 'lin',
      grants: [{ ...base, revoked: true }],
    });
    expect(revoked.some((v) => v.code === 'GRANT_REVOKED')).toBe(true);

    const valid = validateCandidate(c, { now, actorId: 'lin', grants: [base] });
    expect(valid.some((v) => v.code.startsWith('GRANT_'))).toBe(false);
  });
});

describe('待核材料一键修正', () => {
  it('applyPendingVerificationFix 打标并清空 completed 履约', () => {
    const c = chenCase();
    const v = c.visits.find((x) => x.id === 'visit-main')!;
    v.checkInAt = '2026-11-25T09:41:00+08:00';
    v.fulfillment = 'completed';
    c.appointments.find((a) => a.id === 'appt-main')!.status = 'canceled';
    const fixed = applyPendingVerificationFix(c);
    const fv = fixed.visits.find((x) => x.id === 'visit-main')!;
    expect(fv.materialFlag).toBe('pending_verification');
    expect(fv.fulfillment).toBe('');
  });
});
