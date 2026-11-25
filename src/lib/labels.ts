// 路径的中文标签与值格式化（仅用于展示）

const FIELD_LABELS: Record<string, string> = {
  // client
  code: '个案编号',
  name: '姓名',
  age: '年龄',
  gender: '性别',
  district: '网格/片区',
  address: '地址',
  risk: '风险分级',
  household: '同住/家庭',
  background: '背景摘要',
  emergencyContact: '紧急联系人',
  // appointment
  label: '预约类别',
  startAt: '时间',
  durationMin: '时长（分钟）',
  place: '地点',
  status: '状态',
  cancelReason: '取消原因',
  // goal
  title: '标题',
  criteria: '达成指标',
  publishState: '发布状态',
  returnNote: '退回补充意见',
  returnedByName: '退回主管',
  returnedAt: '退回时间',
  // visit
  confirmedGoalText: '本次确认目标',
  visibleScopes: '可查看字段范围',
  checkInAt: '签到时间',
  checkOutAt: '签退时间',
  serviceMinutes: '实际服务时长（分钟）',
  observations: '观察记录',
  actions: '服务动作',
  fulfillment: '履约状态',
  incompleteReasons: '未能完成原因',
  incompleteNote: '未完成说明',
  supplementNote: '补充事实说明（回应退回）',
  supervisorNote: '主管意见',
  materialFlag: '材料核验状态',
  bundledAppointmentId: '捆绑的未来预约',
  serviceDate: '服务日期',
  appointmentId: '关联预约',
  goalId: '关联目标',
  // referral
  org: '机构',
  service: '服务事项',
  reason: '转介原因',
  receiptNo: '回执编号',
  receiptAt: '回执时间',
  // reminder
  text: '内容',
  dueAt: '到期时间',
  done: '是否完成',
  // plan
  goalId_plan: '目标',
  ownerName: '责任人',
  addedAt: '加入计划时间',
  sourceRecordId: '来源记录',
  rev: '版本',
  updatedAt: '更新时间',
  // 迁居移交 / 转介跟进
  applicationNo: '原申请编号',
  submittedMaterials: '已提交材料',
  shareSummary: '机构可见摘要',
  providerDecision: '服务方回执结论',
  providerReturn: '服务方退回',
  providerReturn_reason: '退回原因',
  providerReturn_supplementDue: '补齐截止日',
  providerReturn_missingMaterials: '缺少材料',
  providerAcceptedAt: '接收回执时间',
  followUpDue: '送件时约定期限',
  timeline: '转介时间线',
  transfer: '迁居移交',
  followUps: '跟进责任',
  tasks: '跟进任务',
  ownerOrgId: '责任机构',
  nextAction: '下一动作',
  nextContactDue: '下一次联系期限',
  nextContactNote: '下一次联系说明',
  clientNotified: '客户已获告知',
  clientNotifiedBy: '告知机构',
  clientNotifiedAt: '告知时间',
  attributedOrgId: '完成机构',
  attributedOrgName: '完成机构名称',
};

const COLLECTION_LABELS: Record<string, string> = {
  client: '档案',
  appointments: '预约',
  goals: '服务目标',
  visits: '家访记录',
  referrals: '转介',
  reminders: '提醒',
  plan: '服务计划',
  transfer: '移交',
};

export function pathLabel(path: string): string {
  // 取最后一个 key 段
  const keys = path.match(/\.([^.[\]]+)(?:\[|$)/g);
  let lastKey = path;
  const dotParts = path.split('.');
  lastKey = dotParts[dotParts.length - 1];
  // 去掉可能的数组尾巴（这种情况路径末段一般是 key）
  const fieldLabel = FIELD_LABELS[lastKey] ?? FIELD_LABELS[lastKey.replace(/\[.*$/, '')];

  const collMatch = path.match(/^([a-zA-Z]+)/);
  const coll = collMatch ? COLLECTION_LABELS[collMatch[1]] : undefined;

  // 提取所有 [id]
  const ids = Array.from(path.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]);
  const idCtx = ids.length ? ` · ${ids[ids.length - 1]}` : '';

  if (fieldLabel) return coll ? `${fieldLabel}` : fieldLabel;
  if (keys && keys.length) return lastKey;
  return lastKey;
}

/** 带上下文的完整标签，例如 “观察记录（家访记录 visit-main）” */
export function pathFullLabel(path: string): string {
  const base = pathLabel(path);
  const collMatch = path.match(/^(client|[a-zA-Z]+)/);
  if (!collMatch || collMatch[1] === 'client') return base;
  const coll = COLLECTION_LABELS[collMatch[1]] ?? collMatch[1];
  const ids = Array.from(path.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]);
  const ctx = ids.length ? `（${coll} ${ids[ids.length - 1]}）` : `（${coll}）`;
  return `${base} ${ctx}`;
}

const ENUM_LABELS: Record<string, string> = {
  scheduled: '已预约',
  canceled: '远端已取消',
  fulfilled: '已履约',
  active: '执行中',
  in_review: '待主管确认',
  returned: '已退回补充',
  confirmed: '已确认进入计划',
  draft: '草稿',
  submitted: '已提交待确认',
  completed: '已完成',
  partial: '部分完成',
  incomplete: '未能完成',
  none: '正常',
  pending_verification: '待核材料',
  已退回补件: '已退回补件',
  origin_keeps: '原机构续办',
  transfer_on_move_in: '迁入日转给新机构',
  accepted: '服务方已接收',
  declined: '服务方明确拒绝',
  contact_provider: '联系服务方',
  contact_client: '联系客户',
  supplement_due: '补齐材料并催办',
  provider_contact: '联系服务方记录',
  client_contact: '客户联系记录',
};

const DATE_FIELDS = new Set([
  'startAt',
  'checkInAt',
  'checkOutAt',
  'receiptAt',
  'dueAt',
  'returnedAt',
  'addedAt',
  'issuedAt',
  'expiresAt',
]);

export function formatValue(path: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    if (value.length === 0) return '（空列表）';
    return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('、');
  }
  if (typeof value === 'object') return JSON.stringify(value);

  const lastKey = path.split('.').pop() ?? '';
  const enumKey = String(value);
  if (ENUM_LABELS[enumKey]) return ENUM_LABELS[enumKey];

  if (DATE_FIELDS.has(lastKey)) {
    const n = typeof value === 'number' ? value : Date.parse(String(value));
    if (!Number.isNaN(n)) {
      const d = new Date(n);
      const pad = (x: number) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return String(value);
}

export function enumLabel(v: string): string {
  return ENUM_LABELS[v] ?? v;
}
