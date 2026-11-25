// ============================================================
// 个案协作工作台 —— 领域模型（纯浏览器模拟，全部居民资料均为虚构）
// ============================================================

export type ActorRole = 'social_worker' | 'supervisor';

export interface Actor {
  id: string;
  account: string;
  password: string;
  name: string;
  title: string;
  role: ActorRole;
  /** 所属机构；用于迁居移交中的“唯一跟进责任机构”判定 */
  orgId?: string;
}

// ---------- 居民与受限字段 ----------

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

export interface ClientInfo {
  id: string;
  code: string;
  name: string;
  age: number;
  gender: '女' | '男';
  district: string;
  address: string;
  risk: '重点关注' | '常规';
  household: string;
  background: string;
  /** 受限字段：服务端仅在存在有效授权时下发真值，否则为 null */
  emergencyContact: EmergencyContact | null;
}

// ---------- 预约 ----------

export type AppointmentStatus = 'scheduled' | 'canceled' | 'fulfilled';

export interface Appointment {
  id: string;
  label: '今日家访' | '未来预约' | '过往记录';
  startAt: string; // ISO 字符串
  durationMin: number;
  place: string;
  status: AppointmentStatus;
  cancelReason?: string;
}

// ---------- 服务目标 / 服务计划 ----------

export type GoalPublishState = 'active' | 'in_review' | 'returned' | 'confirmed';

export interface ServiceGoal {
  id: string;
  title: string;
  criteria: string;
  publishState: GoalPublishState;
  returnNote?: string;
  returnedByName?: string;
  returnedAt?: number;
}

export interface PlanEntry {
  id: string;
  goalId: string;
  text: string;
  ownerName: string;
  addedAt: number;
  sourceRecordId: string;
  rev: number;
}

// ---------- 家访 / 服务记录 ----------

export type FulfillmentStatus = '' | 'completed' | 'partial' | 'incomplete';
export type RecordStatus = 'draft' | 'submitted' | 'returned' | 'confirmed';
export type MaterialFlag = 'none' | 'pending_verification';

export interface VisitRecord {
  id: string;
  appointmentId: string;
  goalId: string;
  serviceDate: string; // YYYY-MM-DD
  /** 本次确认的服务目标（文本确认） */
  confirmedGoalText: string;
  /** 本次被授权可查看的字段范围 */
  visibleScopes: string[];
  checkInAt: string | null;
  checkOutAt: string | null;
  serviceMinutes: number | null;
  observations: string;
  actions: string;
  fulfillment: FulfillmentStatus;
  incompleteReasons: string[];
  incompleteNote: string;
  /** 被退回后重新提交时，必须补充的事实说明 */
  supplementNote: string;
  status: RecordStatus;
  supervisorNote?: string;
  /** 迟到签到撞上远端取消等情形：只能形成待核材料 */
  materialFlag: MaterialFlag;
  /** 整次确认单元模式下，被捆绑进同一包的未来预约 id（演示“无关约访改动也等待”） */
  bundledAppointmentId?: string | null;
  /** 完成时所属机构；迁居交接不得改写已完成家访的历史归属 */
  attributedOrgId?: string;
  /** 在哪个机构完成的本次家访（展示用名称快照） */
  attributedOrgName?: string;
}

// ---------- 转介 / 提醒 ----------

export type ReferralStatus = '草稿' | '已发出' | '已退回补件' | '已接收回执' | '已办结';
  /** 服务方对转介的处理结果：接收 / 退回补件 / 明确拒绝 */
export type ProviderDecision = 'accepted' | 'returned' | 'declined';

/** 服务方退回：必须给出缺少的材料与补齐截止日 */
export interface ProviderReturn {
  /** 服务方回执编号（同一退回重复送达时编号相同） */
  referenceNo: string;
  receivedAt: string;
  reason: string;
  missingMaterials: string[];
  /** 补齐材料截止日（YYYY-MM-DD） */
  supplementDue: string;
}

/** 转介时间线上的事件：服务方回执、客户联系、责任转移、迟到同步都归入同一条时间线 */
export type ReferralEventKind =
  | 'referral_sent'
  | 'client_contact'
  | 'provider_contact'
  | 'provider_receipt'
  | 'provider_return'
  | 'duplicate_receipt'
  | 'ownership_assigned'
  | 'ownership_moved'
  | 'late_sync'
  | 'case_closed';

export interface ReferralTimelineEvent {
  id: string;
  referralId: string;
  /** 事件实际发生时间（业务时间） */
  at: string;
  /** 同步/落库时间；迟到同步时显著晚于 at */
  recordedAt?: string;
  /** 事件归属机构（联系记录归属发起机构） */
  orgId: string;
  actorName: string;
  kind: ReferralEventKind;
  summary: string;
  /** 幂等键：同一服务方回执重复送达时相同，用于去重 */
  dedupeKey?: string;
  /** 迟到同步（离线补传）的标记 */
  lateSync?: boolean;
}

export interface Referral {
  id: string;
  org: string;
  service: string;
  reason: string;
  status: ReferralStatus;
  receiptNo?: string;
  receiptAt?: string;
  recordId?: string;
  /** 原申请编号（移交时保留，供新机构接续沟通） */
  applicationNo?: string;
  /** 已提交材料清单 */
  submittedMaterials?: string[];
  /** 服务方回执（接收或退回）；退回用于生成补齐任务 */
  providerDecision?: ProviderDecision;
  providerReturn?: ProviderReturn;
  /** 明确拒绝的原因（仅 declined 时） */
  providerDeclineReason?: string;
  /** 服务方接收回执的时刻（已接收回执时） */
  providerAcceptedAt?: string;
  /** 可供跨机构查看的必要摘要（只读，受授权范围约束） */
  shareSummary?: string;
  /** 送件时服务方要求的跟进/补齐期限（YYYY-MM-DD）；用于在任何回执到达前也有明确 deadline */
  followUpDue?: string;
  /** 本转介的全部事件（服务方回执 + 客户联系 + 责任转移）须在同一时间线 */
  timeline?: ReferralTimelineEvent[];
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  done: boolean;
}

// ---------- 迁居移交：唯一跟进责任 ----------

/**
 * 两种合规的移交方式：
 * - origin_keeps：责任留在原机构，直至服务方接受或明确拒绝；
 * - transfer_on_move_in：迁入日把跟进责任交给新机构，原机构停止联系。
 */
export type TransferPolicy = 'origin_keeps' | 'transfer_on_move_in';

export interface TransferOrg {
  id: string;
  name: string;
  kind: 'origin' | 'receiving' | 'provider';
  district?: string;
}

/** 某项未结转介在移交后的唯一跟进责任 */
export interface ReferralFollowUp {
  id: string;
  referralId: string;
  policy: TransferPolicy;
  /** 当前唯一可发起客户/服务方联系的机构 id */
  ownerOrgId: string;
  ownerName: string;
  /** 下一个必须执行的联系动作 */
  nextAction: 'contact_provider' | 'contact_client' | 'none';
  nextContactDue: string;
  nextContactNote: string;
  /** 责任归属生效时间 */
  assignedAt: string;
  /** 客户已获告知的内容（含说明人与告知时间） */
  clientNotified: string;
  clientNotifiedBy: string;
  clientNotifiedAt: string;
  /** 责任转移次数；仅允许按策略发生一次，避免来回夺权 */
  movedCount: number;
}

export type FollowUpTaskKind = 'provider_contact' | 'client_contact' | 'supplement_due';

export interface FollowUpTask {
  id: string;
  referralId: string;
  kind: FollowUpTaskKind;
  /** 该任务由哪个机构持有 */
  ownerOrgId: string;
  ownerName: string;
  dueAt: string;
  status: 'open' | 'done' | 'superseded';
  createdAt: string;
  note: string;
  /** 幂等键：同一退回回执只生成一条补齐/催办任务 */
  dedupeKey: string;
}

export interface CaseTransfer {
  moveInDate: string;
  originOrg: TransferOrg;
  receivingOrg: TransferOrg;
  /** 新机构已接收服务计划 / 预约的时刻 */
  planReceivedAt: string;
  appointmentReceivedAt: string;
  /** 按 referralId 索引的唯一跟进责任 */
  followUps: ReferralFollowUp[];
  /** 已确定移交方式并写入唯一责任的时刻；未确定时允许尚未生成跟进责任 */
  activatedAt?: string;
  tasks: FollowUpTask[];
  /** 移交时冻结的历史归属：recordId -> orgId（交接不改变已完成家访的归属） */
  historyAttribution: Record<string, string>;
  /** 客户对整体移交的偏好/已同意内容 */
  clientPreference: string;
  /** 各机构被授权的摘要范围：orgId -> 字段范围（如 '转介摘要'、'家访历史'） */
  orgScopes: Record<string, string[]>;
  /** 离线尚未补传的客户联系记录；补传后进入时间线并标记迟到，不改变责任归属 */
  pendingOffline?: ReferralTimelineEvent[];
}

// ---------- 案卷聚合根（模拟 REST /api/cases/:id 的整体文档与版本号） ----------

export interface CaseFile {
  id: string;
  rev: number;
  updatedAt: number;
  client: ClientInfo;
  appointments: Appointment[];
  goals: ServiceGoal[];
  visits: VisitRecord[];
  referrals: Referral[];
  reminders: Reminder[];
  plan: PlanEntry[];
  /** 仅迁居移交个案存在 */
  transfer?: CaseTransfer;
}

// ---------- 字段授权凭据（绑定明确到期时刻） ----------

export interface FieldGrant {
  id: string;
  caseId: string;
  field: 'client.emergencyContact';
  granteeActorId: string;
  granteeName: string;
  reason: string;
  issuedAt: number;
  expiresAt: number;
  ttlLabel: string;
  revoked: boolean;
  revokedAt?: number;
  revokeReason?: string;
}

/** IndexedDB sensitive store 中的持久缓存：值必须与到期凭据一起存放 */
export interface SensitiveCacheEntry {
  cacheKey: string; // `${caseId}:client.emergencyContact`
  caseId: string;
  field: 'client.emergencyContact';
  value: EmergencyContact;
  grantId: string;
  expiresAt: number;
  cachedAt: number;
}

// ---------- 审计 ----------

export type AuditActorRole = ActorRole | 'system' | 'sync-engine';

export interface AuditEntry {
  id: string;
  at: number;
  actorId: string;
  actorName: string;
  actorRole: AuditActorRole;
  tabId: string;
  action: string;
  target: string;
  summary: string;
  caseId?: string;
  rev?: number;
  fingerprint: string;
}

// ---------- 本地草稿 / 待同步操作 ----------

export type Granularity = 'field' | 'unit';

export interface DraftEnvelope {
  caseId: string;
  /** 每项编辑所依据的远端版本 */
  baseRev: number;
  base: CaseFile;
  value: CaseFile;
  granularity: Granularity;
  updatedAt: number;
  tabId: string;
}

export type OutboxStatus = 'queued' | 'syncing' | 'synced' | 'blocked';

export interface OutboxOp {
  id: string;
  caseId: string;
  tabId: string;
  actorId: string;
  label: string;
  at: number;
  /** 该编辑依据的远端版本 */
  baseRev: number;
  status: OutboxStatus;
  syncedRev?: number;
  detail?: string;
}

// ---------- 三方比较 / 合并 ----------

export type TriadStatus =
  | 'unchanged'
  | 'local-only'
  | 'remote-only'
  | 'same-both'
  | 'conflict';

export interface PathDiff {
  path: string;
  label: string;
  groupId: string | null;
  unitId: string | null;
  base: unknown;
  local: unknown;
  remote: unknown;
  status: TriadStatus;
  changed: boolean;
}

export type ItemKind = 'independent' | 'correlated' | 'unit';
export type ItemAuto = 'auto-local' | 'auto-remote' | 'auto-same' | 'needs-decision';
export type Decision = 'remote' | 'local' | 'defer';

export interface MergeItem {
  id: string;
  kind: ItemKind;
  title: string;
  why: string;
  paths: string[];
  auto: ItemAuto;
  /** needs-decision 时必须由人工选择 */
  decision: Decision | null;
  /** 人工裁决时直接编辑后的路径值（路径 -> JSON 值） */
  manual: Record<string, unknown>;
}

export interface MergeAnalysis {
  caseId: string;
  baseRev: number;
  localRev: number;
  remoteRev: number;
  granularity: Granularity;
  paths: PathDiff[];
  items: MergeItem[];
  /** 不需要人工介入、可自动保留的路径说明 */
  autoNotes: string[];
}

// ---------- 领域守卫 ----------

export type ViolationCode =
  | 'APPT_CANCELED_CHECKIN'
  | 'GOAL_RETURNED_LOCK'
  | 'GRANT_REQUIRED'
  | 'GRANT_EXPIRED'
  | 'GRANT_REVOKED'
  | 'MISSING_SUPPLEMENT'
  | 'FULFILLMENT_NEEDS_FACTS'
  | 'TRANSFER_DUAL_OWNER'
  | 'TRANSFER_DUPLICATE_TASK'
  | 'TRANSFER_OWNER_MISMATCH'
  | 'TRANSFER_DEADLINE_MISSED'
  | 'TRANSFER_CONTACT_BY_NON_OWNER'
  | 'TRANSFER_CLOSE_WITH_OPEN_REFERRAL'
  | 'TRANSFER_LATE_SYNC_USURPS'
  | 'TRANSFER_HISTORY_REATTRIBUTED';

export interface Violation {
  code: ViolationCode;
  path?: string;
  title: string;
  detail: string;
  /** 可一键修正时给出修正动作标识 */
  fix?: 'mark-pending-verification';
}

// ---------- 模拟接口返回 ----------

export type CommitResult =
  | { ok: true; case: CaseFile; audits: AuditEntry[] }
  | { ok: false; code: 'NETWORK'; message: string }
  | {
      ok: false;
      code: 'CONFLICT';
      current: CaseFile;
      baseSnapshot: CaseFile | null;
      serverRev: number;
    }
  | { ok: false; code: 'GUARD'; violations: Violation[]; current?: CaseFile };

export interface TabPresence {
  tabId: string;
  actorId?: string;
  actorName?: string;
  at: number;
}
