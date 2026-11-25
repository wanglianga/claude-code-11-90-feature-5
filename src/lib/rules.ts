import type { CaseFile, FieldGrant, Violation } from '../types';
import { validateTransfer } from './transfer';

export interface RuleContext {
  /** 最新远端案卷（用于识别“远端已取消/已退回”） */
  current?: CaseFile | null;
  grants?: FieldGrant[];
  now?: number;
  actorId?: string;
}

export function grantState(
  grant: FieldGrant | undefined | null,
  now: number,
): 'none' | 'valid' | 'expired' | 'revoked' {
  if (!grant) return 'none';
  if (grant.revoked) return 'revoked';
  if (grant.expiresAt <= now) return 'expired';
  return 'valid';
}

/** 提交候选文档前的权威领域校验。客户端 Conflict UI 与模拟服务端共用同一份规则。 */
export function validateCandidate(candidate: CaseFile, ctx: RuleContext = {}): Violation[] {
  const violations: Violation[] = [];
  const now = ctx.now ?? Date.now();
  const current = ctx.current ?? null;

  const remoteAppt = new Map(current?.appointments.map((a) => [a.id, a]) ?? []);
  const remoteGoal = new Map(current?.goals.map((g) => [g.id, g]) ?? []);

  // 1) 预约取消守卫：远端已取消 → 不允许改回 scheduled/fulfilled；迟到签到只能形成待核材料
  for (const appt of candidate.appointments) {
    const ra = remoteAppt.get(appt.id);
    if (ra?.status === 'canceled' && appt.status !== 'canceled') {
      violations.push({
        code: 'APPT_CANCELED_CHECKIN',
        path: `appointments[${appt.id}].status`,
        title: '预约已被远端取消',
        detail: `远端状态为“已取消”（${ra.cancelReason ?? '家属/服务对象原因'}）。离线签到不能把取消态改回${
          appt.status === 'fulfilled' ? '“已履约”' : '“已预约”'
        }。`,
        fix: 'mark-pending-verification',
      });
    }
  }

  for (const v of candidate.visits) {
    if (!v.checkInAt) continue;
    const appt = candidate.appointments.find((a) => a.id === v.appointmentId);
    const remoteCanceled =
      appt?.status === 'canceled' || remoteAppt.get(v.appointmentId)?.status === 'canceled';

    if (remoteCanceled) {
      if (v.materialFlag !== 'pending_verification') {
        violations.push({
          code: 'APPT_CANCELED_CHECKIN',
          path: `visits[${v.id}].materialFlag`,
          title: '迟到签到须转为待核材料',
          detail:
            '该预约在签到上传前已被远端取消。签到记录可以保留，但只能作为“待核材料”，由主管/调度核实，不能据此记为已履约。',
          fix: 'mark-pending-verification',
        });
      }
      if (v.fulfillment === 'completed') {
        violations.push({
          code: 'FULFILLMENT_NEEDS_FACTS',
          path: `visits[${v.id}].fulfillment`,
          title: '取消预约下不能判定“已完成服务”',
          detail:
            '预约已取消，迟到的签到不构成有效履约。请改判为部分完成/未能完成并说明情况，或仅保留待核材料后清空履约结论。',
          fix: 'mark-pending-verification',
        });
      }
    }

    // 已完成必须有最基本事实：实际时长 + 观察
    if (v.fulfillment === 'completed') {
      if (v.serviceMinutes === null || v.serviceMinutes <= 0) {
        violations.push({
          code: 'FULFILLMENT_NEEDS_FACTS',
          path: `visits[${v.id}].serviceMinutes`,
          title: '“已完成”缺少实际服务时长',
          detail: '请登记实际服务时长（分钟）；提醒已读或转介回执不能替代服务时长。',
        });
      }
      if (v.observations.trim().length < 10) {
        violations.push({
          code: 'FULFILLMENT_NEEDS_FACTS',
          path: `visits[${v.id}].observations`,
          title: '“已完成”缺少观察事实',
          detail: '观察记录至少需要 10 个字，说明本次实际见到/做到的事实，不能只凭回执或提醒勾销。',
        });
      }
    }
  }

  // 2) 主管退回锁：远端目标为 returned 时，旧草稿不能直接重新发布；必须附补充事实
  for (const g of candidate.goals) {
    const rg = remoteGoal.get(g.id);
    if (rg?.publishState !== 'returned') continue;
    const leavingReturned = g.publishState === 'in_review' || g.publishState === 'active';
    if (!leavingReturned) continue;

    const linkedVisit = candidate.visits.find((v) => v.goalId === g.id);
    const supplement = linkedVisit?.supplementNote?.trim() ?? '';
    if (supplement.length < 5) {
      violations.push({
        code: 'GOAL_RETURNED_LOCK',
        path: `goals[${g.id}].publishState`,
        title: '该服务目标已被主管退回',
        detail: `退回意见：“${rg.returnNote ?? '请补充事实'}”。旧标签页的草稿依据的是退回前的版本，不能越过退回直接重新发布。请先在“补充事实说明”中回应退回意见，再重新提交。`,
      });
      violations.push({
        code: 'MISSING_SUPPLEMENT',
        path: linkedVisit ? `visits[${linkedVisit.id}].supplementNote` : undefined,
        title: '缺少针对退回的补充说明',
        detail: '补充事实说明不少于 5 个字，并应写清新核实到的事实。',
      });
    }
  }

  // 3) 授权凭据校验（若上下文提供了授权列表）
  if (ctx.grants) {
    const active = ctx.grants.find(
      (g) =>
        g.field === 'client.emergencyContact' &&
        (!ctx.actorId || g.granteeActorId === ctx.actorId),
    );
    const st = grantState(active, now);
    // 只有在候选文档显式携带真值紧急联系人时才强制；正常草稿不含该受限值。
    const carriesSecret = candidate.client?.emergencyContact?.phone;
    if (carriesSecret) {
      if (st === 'none') {
        violations.push({
          code: 'GRANT_REQUIRED',
          path: 'client.emergencyContact',
          title: '紧急联系人需要有效授权',
          detail: '本次提交包含受限字段“紧急联系人”，但找不到绑定的授权凭据。',
        });
      } else if (st === 'expired') {
        violations.push({
          code: 'GRANT_EXPIRED',
          path: 'client.emergencyContact',
          title: '查看授权已到期',
          detail: '授权凭据的到期时刻已过；即使设备离线，也必须遮蔽并清除该值，不能提交。',
        });
      } else if (st === 'revoked') {
        violations.push({
          code: 'GRANT_REVOKED',
          path: 'client.emergencyContact',
          title: '授权已被家属撤回',
          detail: '撤权消息已到达：该值必须从界面、剪贴板与持久缓存删除，不能选择“仍使用本地值”提交。',
        });
      }
    }
  }

  // 4) 迁居移交不变量（仅当案卷带有 transfer 时生效）
  if (candidate.transfer) {
    violations.push(...validateTransfer(candidate, { previous: current ?? null }));
  }

  return violations;
}

/** 一键修正：把与取消预约相关的违规统一改为待核材料形态 */
export function applyPendingVerificationFix(input: CaseFile): CaseFile {
  const next = structuredClone(input);
  for (const v of next.visits) {
    const appt = next.appointments.find((a) => a.id === v.appointmentId);
    if (appt?.status === 'canceled' && v.checkInAt) {
      v.materialFlag = 'pending_verification';
      if (v.fulfillment === 'completed') v.fulfillment = '';
    }
  }
  // 同时确保没有任何预约被从 canceled 改走
  // （需要 current 才能判定，调用方在合并候选上已保留远端 canceled，这里无需处理）
  return next;
}
