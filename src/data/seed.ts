import type { Actor, AuditEntry, CaseFile } from '../types';
import { iso } from '../lib/time';
// 所有居民、机构、电话均为虚构，仅用于浏览器内演示。
// 标准样例日：2026-11-25（周三）。

const T = {
  today900: new Date(iso(2026, 11, 25, 9, 0)).getTime(),
  v7updated: new Date(iso(2026, 11, 25, 8, 42)).getTime(),
};

export function seedCases(): CaseFile[] {
  return [chenCase(), liangCase(), wuCase(), zhaoCase(), heCase(), c21Case()];
}

/** 题目指定的核心样例：9:00 两标签页共同读取的版本 7 */
export function chenCase(): CaseFile {
  return {
    id: 'case-chen',
    rev: 7,
    updatedAt: T.v7updated,
    client: {
      id: 'cl-chen',
      code: 'GA-2026-0117',
      name: '陈桂兰',
      age: 78,
      gender: '女',
      district: '清河街道 · 第三网格',
      address: '清河里 6 号楼 3 单元 201（虚构地址）',
      risk: '重点关注',
      household: '独居；侄子陈志强每周探望一次',
      background:
        '高血压、糖尿病随访；助餐对象。近期反馈忘服降压药，上周曾在楼道迷路约 20 分钟。本次家访重点核实用药与进食情况。',
      // 服务端默认按“无有效授权”脱敏下发；真值只保存在远端模拟库与绑定到期时刻的本地敏感缓存中。
      emergencyContact: {
        name: '陈志强',
        relation: '侄子（家属）',
        phone: '139-0000-2046（虚构号码）',
      },
    },
    appointments: [
      {
        id: 'appt-main',
        label: '今日家访',
        startAt: iso(2026, 11, 25, 9, 30),
        durationMin: 60,
        place: '服务对象家中',
        status: 'scheduled',
      },
      {
        id: 'appt-next',
        label: '未来预约',
        startAt: iso(2026, 11, 27, 14, 0), // 原定周五 14:00，B 将改到周三 12-02 10:00
        durationMin: 45,
        place: '清河社区居委会 2 号会客室',
        status: 'scheduled',
      },
      {
        id: 'appt-past',
        label: '过往记录',
        startAt: iso(2026, 11, 18, 9, 30),
        durationMin: 55,
        place: '服务对象家中',
        status: 'fulfilled',
      },
    ],
    goals: [
      {
        id: 'goal-meal',
        title: '规律进食与安全用药',
        criteria:
          '连续 4 周每日使用助餐；降压药按分格药盒服用，漏服不超过 1 次/周，并能说出生病时联系谁。',
        // v7：林晓 8:40 已提交初版记录，主管尚未给出结论
        publishState: 'in_review',
      },
      {
        id: 'goal-fall',
        title: '降低居家跌倒风险',
        criteria: '完成浴室防滑与夜灯改造；楼道认识返程路线。',
        publishState: 'confirmed',
      },
    ],
    visits: [
      {
        id: 'visit-main',
        appointmentId: 'appt-main',
        goalId: 'goal-meal',
        serviceDate: '2026-11-25',
        confirmedGoalText: '规律进食与安全用药：本次核实助餐食用、降压药服用与漏服情况。',
        visibleScopes: ['基本档案', '健康摘要', '服务计划'],
        checkInAt: null,
        checkOutAt: null,
        serviceMinutes: null,
        observations:
          '访前摘要：助餐配送正常；社区医院反馈其 11 月 24 日未到药房取降压药，需当面核实。',
        actions: '',
        fulfillment: '',
        incompleteReasons: [],
        incompleteNote: '',
        supplementNote: '',
        status: 'submitted',
        supervisorNote: '',
        materialFlag: 'none',
        bundledAppointmentId: null,
      },
      {
        id: 'visit-past',
        appointmentId: 'appt-past',
        goalId: 'goal-fall',
        serviceDate: '2026-11-18',
        confirmedGoalText: '降低居家跌倒风险：检查防滑垫与夜灯使用。',
        visibleScopes: ['基本档案', '居家环境评估'],
        checkInAt: iso(2026, 11, 18, 9, 32),
        checkOutAt: iso(2026, 11, 18, 10, 27),
        serviceMinutes: 55,
        observations:
          '浴室防滑垫已铺设，夜灯已安装；能复述从小区花园返回 6 号楼的路线。建议继续佩戴联系卡。',
        actions: '现场检查改造情况；陪同演练返程路线一次。',
        fulfillment: 'completed',
        incompleteReasons: [],
        incompleteNote: '',
        supplementNote: '',
        status: 'confirmed',
        supervisorNote: '事实完整，确认进入服务计划。',
        materialFlag: 'none',
      },
    ],
    referrals: [
      {
        id: 'ref-meal',
        org: '清河街道养老助餐点',
        service: '老年营养午餐配送',
        reason: '独居、做饭困难',
        status: '已接收回执',
        receiptNo: 'HZ-20261112-031',
        receiptAt: iso(2026, 11, 12, 16, 20),
        recordId: 'visit-past',
      },
      {
        id: 'ref-pharm',
        org: '清河社区卫生服务中心',
        service: '慢病用药管理小组',
        reason: '疑似漏服降压药，需药师跟进分格药盒',
        status: '已发出',
      },
    ],
    reminders: [
      {
        id: 'rem-card',
        text: '提醒服务对象随身携带写有姓名与社区电话的联系卡',
        dueAt: iso(2026, 11, 25, 18, 0),
        done: false,
      },
      {
        id: 'rem-nephew',
        text: '如再次漏药，联系侄子陈志强共同核对药盒',
        dueAt: iso(2026, 11, 26, 12, 0),
        done: false,
      },
    ],
    plan: [
      {
        id: 'plan-fall-1',
        goalId: 'goal-fall',
        text: '浴室防滑垫 + 床头到卫生间感应夜灯已到位；每周三邻居帮忙查看一次。',
        ownerName: '林晓',
        addedAt: new Date(iso(2026, 11, 18, 11, 0)).getTime(),
        sourceRecordId: 'visit-past',
        rev: 3,
      },
    ],
  };
}

function liangCase(): CaseFile {
  return baseCase({
    id: 'case-liang',
    code: 'GA-2026-0102',
    name: '梁广生',
    age: 82,
    gender: '男',
    district: '清河街道 · 第二网格',
    address: '滨河大院 2 号楼 1 单元 402（虚构地址）',
    risk: '重点关注',
    household: '与保姆同住；子女在外地',
    background: '脑梗后康复期，左侧肢体无力；需核实康复训练与防跌倒情况。',
    appt: iso(2026, 11, 25, 10, 30),
    goalTitle: '居家康复训练维持',
    goalCriteria: '每周完成 3 次扶行训练；血压记录完整。',
    obs: '访前摘要：保姆反映本周训练约 2 次，需现场评估步态。',
  });
}

function wuCase(): CaseFile {
  return baseCase({
    id: 'case-wu',
    code: 'WT-2026-0066',
    name: '吴小梅家庭',
    age: 34,
    gender: '女',
    district: '清河街道 · 第一网格',
    address: '晨光里 9 号楼 5 单元 101（虚构地址）',
    risk: '常规',
    household: '吴小梅与 9 岁女儿同住',
    background: '亲子沟通与课业支持随访；近期班主任反映孩子上课注意力下降。',
    appt: iso(2026, 11, 25, 14, 0),
    goalTitle: '稳定亲子作息与课业陪伴',
    goalCriteria: '工作日 21:30 前熄灯；每周三次亲子阅读 20 分钟。',
    obs: '访前摘要：上月约定的作息表仅执行一周，需了解障碍。',
  });
}

function zhaoCase(): CaseFile {
  const c = baseCase({
    id: 'case-zhao',
    code: 'GA-2026-0088',
    name: '赵德海',
    age: 75,
    gender: '男',
    district: '清河街道 · 第三网格',
    address: '清河里 12 号楼 1 单元 601（虚构地址）',
    risk: '常规',
    household: '夫妻同住',
    background: '膝关节术后恢复；关注复诊与辅具使用。',
    appt: iso(2026, 11, 26, 9, 0),
    goalTitle: '术后活动能力恢复',
    goalCriteria: '可独立持助行器行走 200 米；按时复诊。',
    obs: '访前摘要：术后六周，复诊安排在本周四。',
  });
  c.appointments[0].label = '未来预约';
  return c;
}

function heCase(): CaseFile {
  const c = baseCase({
    id: 'case-he',
    code: 'GA-2026-0095',
    name: '何丽娟',
    age: 68,
    gender: '女',
    district: '清河街道 · 第二网格',
    address: '滨河大院 5 号楼 3 单元 303（虚构地址）',
    risk: '常规',
    household: '与配偶同住',
    background: '焦虑情绪伴睡眠困难；已转介心理支持，本次跟进回执与就诊意愿。',
    appt: iso(2026, 11, 27, 15, 30),
    goalTitle: '睡眠与情绪支持',
    goalCriteria: '完成心理科首次评估；连续两周睡眠日记。',
    obs: '访前摘要：心理热线回执已到，需确认是否愿意线下就诊。',
  });
  c.appointments[0].label = '未来预约';
  c.referrals = [
    {
      id: 'ref-he-1',
      org: '区社会心理服务指导中心',
      service: '老年情绪支持面谈',
      reason: '入睡困难、持续紧张',
      status: '已接收回执',
      receiptNo: 'XL-20261120-118',
      receiptAt: iso(2026, 11, 21, 10, 0),
    },
  ];
  return c;
}

interface BaseArgs {
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
  appt: string;
  goalTitle: string;
  goalCriteria: string;
  obs: string;
}

/** 其他个案的通用构造，保证列表与详情均可操作 */
function baseCase(a: BaseArgs): CaseFile {
  const apptId = `${a.id}-appt-1`;
  const goalId = `${a.id}-goal-1`;
  const visitId = `${a.id}-visit-1`;
  return {
    id: a.id,
    rev: 2,
    updatedAt: Date.parse(a.appt) - 3600_000,
    client: {
      id: `${a.id}-client`,
      code: a.code,
      name: a.name,
      age: a.age,
      gender: a.gender,
      district: a.district,
      address: a.address,
      risk: a.risk,
      household: a.household,
      background: a.background,
      emergencyContact: {
        name: '家属（虚构）',
        relation: '子女',
        phone: '139-0000-0000（虚构号码）',
      },
    },
    appointments: [
      {
        id: apptId,
        label: '今日家访',
        startAt: a.appt,
        durationMin: 45,
        place: '服务对象家中',
        status: 'scheduled',
      },
    ],
    goals: [
      {
        id: goalId,
        title: a.goalTitle,
        criteria: a.goalCriteria,
        publishState: 'active',
      },
    ],
    visits: [
      {
        id: visitId,
        appointmentId: apptId,
        goalId,
        serviceDate: a.appt.slice(0, 10),
        confirmedGoalText: a.goalTitle,
        visibleScopes: ['基本档案', '服务计划'],
        checkInAt: null,
        checkOutAt: null,
        serviceMinutes: null,
        observations: a.obs,
        actions: '',
        fulfillment: '',
        incompleteReasons: [],
        incompleteNote: '',
        supplementNote: '',
        status: 'draft',
        supervisorNote: '',
        materialFlag: 'none',
        bundledAppointmentId: null,
      },
    ],
    referrals: [],
    reminders: [],
    plan: [],
  };
}

/*
 * 样例个案 C-21：长者迁居移交。
 * 2026-06-01 迁入新桥街道（新机构），已有两条完成家访（05-18、05-26）与 06-03 预约；
 * 转介 RH-4 于 05-28 送往康复服务方，要求 06-05 前补齐行动能力评估。
 * 服务方 06-02 10:00 退回缺评估；原社工 05-31 一条客户联系记录离线，至 06-03 才补传。
 * 该案卷初始仅记录“移交事实”，尚未决定移交方式（两种方式由场景页/移交面板分别回放）。
 */
export function c21Case(): CaseFile {
  const originOrg = {
    id: 'org-qinghe',
    name: '清河街道综合服务中心',
    kind: 'origin' as const,
    district: '清河街道',
  };
  const receivingOrg = {
    id: 'org-xinqiao',
    name: '新桥街道综合服务中心',
    kind: 'receiving' as const,
    district: '新桥街道',
  };
  const providerOrg = {
    id: 'org-rehab',
    name: '区康复服务指导中心',
    kind: 'provider' as const,
  };
  return {
    id: 'case-c21',
    rev: 3,
    updatedAt: new Date(iso(2026, 6, 3, 9, 10)).getTime(),
    client: {
      id: 'cl-c21',
      code: 'C-21',
      name: '卢凤仪',
      age: 84,
      gender: '女',
      district: '新桥街道 · 第七网格（2026-06-01 自清河街道迁入）',
      address: '新桥里 3 号院 2 单元 104（虚构地址）',
      risk: '重点关注',
      household: '迁居后与女儿同住；日常由女儿协助服药',
      background:
        '高血压、行动能力下降；迁居前由清河街道随访。迁居后服务计划与预约已由新桥街道接收，转介 RH-4（行动能力评估）尚无服务方回执。',
      emergencyContact: {
        name: '赵敏（女儿）',
        relation: '女儿（同住）',
        phone: '137-0000-5521（虚构号码）',
      },
    },
    appointments: [
      {
        id: 'c21-appt-0603',
        label: '未来预约',
        startAt: iso(2026, 6, 3, 10, 0),
        durationMin: 50,
        place: '新桥里 3 号院 2 单元 104（服务对象家中）',
        status: 'scheduled',
      },
    ],
    goals: [
      {
        id: 'c21-goal-mobility',
        title: '维持居家行动能力与防跌倒',
        criteria: '每周完成 3 次扶行训练；浴室防滑与夜灯到位；按时复诊。',
        publishState: 'confirmed',
      },
    ],
    visits: [
      {
        id: 'c21-visit-0518',
        appointmentId: 'c21-appt-0518',
        goalId: 'c21-goal-mobility',
        serviceDate: '2026-05-18',
        confirmedGoalText: '维持居家行动能力与防跌倒：核实扶行训练与浴室防滑。',
        visibleScopes: ['基本档案', '居家环境评估', '服务计划'],
        checkInAt: iso(2026, 5, 18, 9, 30),
        checkOutAt: iso(2026, 5, 18, 10, 25),
        serviceMinutes: 55,
        observations: '浴室防滑垫已铺设；可在助行器辅助下于室内行走约 120 米，步速偏慢。',
        actions: '现场演示扶行训练动作；与女儿确认每周三次训练安排。',
        fulfillment: 'completed',
        incompleteReasons: [],
        incompleteNote: '',
        supplementNote: '',
        status: 'confirmed',
        supervisorNote: '事实完整，确认进入服务计划。',
        materialFlag: 'none',
        bundledAppointmentId: null,
        attributedOrgId: originOrg.id,
        attributedOrgName: originOrg.name,
      },
      {
        id: 'c21-visit-0526',
        appointmentId: 'c21-appt-0526',
        goalId: 'c21-goal-mobility',
        serviceDate: '2026-05-26',
        confirmedGoalText: '维持居家行动能力与防跌倒：复查训练与夜灯使用。',
        visibleScopes: ['基本档案', '居家环境评估'],
        checkInAt: iso(2026, 5, 26, 9, 35),
        checkOutAt: iso(2026, 5, 26, 10, 20),
        serviceMinutes: 45,
        observations: '夜灯已安装；女儿反映近日右膝酸软，训练减少到每周一次，已建议转康复评估。',
        actions: '记录训练频次；与服务对象商定转介康复服务方评估行动能力。',
        fulfillment: 'completed',
        incompleteReasons: [],
        incompleteNote: '',
        supplementNote: '',
        status: 'confirmed',
        supervisorNote: '同意转介康复服务方。',
        materialFlag: 'none',
        bundledAppointmentId: null,
        attributedOrgId: originOrg.id,
        attributedOrgName: originOrg.name,
      },
    ],
    referrals: [
      {
        id: 'ref-rh4',
        org: providerOrg.name,
        service: '行动能力评估与居家康复计划',
        reason: '右膝酸软、训练频次下降，需专业评估后制定训练方案',
        status: '已发出',
        applicationNo: 'RH-4',
        submittedMaterials: ['家访记录 05-18', '家访记录 05-26', '用药清单', '女儿知情同意书'],
        followUpDue: '2026-06-05',
        shareSummary:
          'RH-4：05-28 送康复服务方，要求 06-05 前补齐行动能力评估；已提交两条家访记录、用药清单与知情同意书。',
        // 初始时间线只含已送出的申请；05-31 的客户联系仍离线，尚未补传（见 transfer.pendingOffline）
        timeline: [
          {
            id: 'evt-rh4-sent',
            referralId: 'ref-rh4',
            at: iso(2026, 5, 28, 15, 0),
            recordedAt: iso(2026, 5, 28, 15, 0),
            orgId: originOrg.id,
            actorName: '林晓',
            kind: 'referral_sent',
            summary: '原机构将 RH-4 送往区康复服务指导中心，附家访记录、用药清单与知情同意书。',
          },
        ],
      },
    ],
    reminders: [
      {
        id: 'c21-rem-movein',
        text: '迁居后首次家访：确认新住址环境与服药安排',
        dueAt: iso(2026, 6, 3, 10, 0),
        done: false,
      },
    ],
    plan: [
      {
        id: 'c21-plan-1',
        goalId: 'c21-goal-mobility',
        text: '浴室防滑与夜灯已完成；每周三次扶行训练由女儿陪同（迁居前由清河街道确认）。',
        ownerName: '林晓',
        addedAt: new Date(iso(2026, 5, 18, 11, 0)).getTime(),
        sourceRecordId: 'c21-visit-0518',
        rev: 3,
      },
    ],
    transfer: {
      moveInDate: '2026-06-01',
      originOrg,
      receivingOrg,
      planReceivedAt: iso(2026, 6, 1, 11, 0),
      appointmentReceivedAt: iso(2026, 6, 1, 11, 20),
      followUps: [],
      tasks: [],
      historyAttribution: {
        'c21-visit-0518': originOrg.id,
        'c21-visit-0526': originOrg.id,
      },
      clientPreference:
        '客户优先希望由熟悉的原社工说明材料；但在责任转交后，同意由新机构社工接续沟通。',
      orgScopes: {
        [originOrg.id]: ['转介摘要', '家访历史'],
        [receivingOrg.id]: ['转介摘要', '家访历史'],
        [providerOrg.id]: ['转介摘要'],
      },
      pendingOffline: [
        {
          id: 'evt-rh4-contact-0531',
          referralId: 'ref-rh4',
          at: iso(2026, 5, 31, 16, 20),
          recordedAt: iso(2026, 6, 3, 9, 5),
          orgId: originOrg.id,
          actorName: '林晓',
          kind: 'client_contact',
          lateSync: true,
          summary:
            '原社工向客户解释：服务方可能要求补做行动能力评估，补齐材料前不需要客户另行联系服务方。',
        },
      ],
    },
  };
}

export function seedAudits(systemActor: Actor): AuditEntry[] {
  const now = T.today900;
  return [
    {
      id: 'audit-seed-1',
      at: now - 18 * 60_000,
      actorId: systemActor.id,
      actorName: systemActor.name,
      actorRole: 'system',
      tabId: 'seed',
      action: 'seed',
      target: 'case-chen',
      summary: '写入虚构基线数据：陈桂兰案卷版本 7（含 8:40 已提交、待主管确认的记录）。',
      caseId: 'case-chen',
      rev: 7,
      fingerprint: 'seed',
    },
  ];
}
