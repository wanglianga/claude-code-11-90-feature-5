import type {
  CaseFile,
  Decision,
  MergeAnalysis,
  MergeItem,
  PathDiff,
  TriadStatus,
} from '../types';
import { eqValue, flatten, getPath, setPathEnsuringElement } from './paths';

type Root = CaseFile | null | undefined;

interface UnitMeta {
  vid: string;
  goalId?: string;
  apptIds: string[];
}

interface UnitPolicy {
  corrOf: Map<string, string>;
  corrTitle: Map<string, string>;
  bundled: Map<string, UnitMeta>;
}

/**
 * 根据案卷中的 visit ↔ goal ↔ appointment 关联关系，构造：
 * - corr:<visitId> 关联组：服务目标发布状态 + 记录状态/履约等必须整体裁决的字段
 * - unit:<visitId> 整次家访确认单元：该次记录的全部字段 + 关联目标 + 捆绑的未来预约
 */
function buildPolicy(roots: Root[]): UnitPolicy {
  const corrOf = new Map<string, string>();
  const corrTitle = new Map<string, string>();
  const bundled = new Map<string, UnitMeta>();

  const visitIds = new Set<string>();
  const goalByVisit = new Map<string, string>();
  const bundledAppts = new Map<string, Set<string>>();

  for (const r of roots) {
    if (!r) continue;
    for (const v of r.visits ?? []) {
      visitIds.add(v.id);
      if (v.goalId) goalByVisit.set(v.id, v.goalId);
      if (v.bundledAppointmentId) {
        if (!bundledAppts.has(v.id)) bundledAppts.set(v.id, new Set());
        bundledAppts.get(v.id)!.add(v.bundledAppointmentId);
      }
    }
  }

  for (const vid of visitIds) {
    const corrId = `corr:${vid}`;
    corrTitle.set(corrId, `关联状态组 · ${vid}`);
    const corrPaths = [
      `visits[${vid}].status`,
      `visits[${vid}].fulfillment`,
      `visits[${vid}].confirmedGoalText`,
      `visits[${vid}].supplementNote`,
    ];
    const gid = goalByVisit.get(vid);
    if (gid) {
      corrPaths.push(`goals[${gid}].publishState`);
      corrPaths.push(`goals[${gid}].returnNote`);
    }
    for (const p of corrPaths) corrOf.set(p, corrId);

    bundled.set(`unit:${vid}`, {
      vid,
      goalId: gid,
      apptIds: bundledAppts.get(vid) ? [...bundledAppts.get(vid)!] : [],
    });
  }

  return { corrOf, corrTitle, bundled };
}

function unitMembership(path: string, policy: UnitPolicy): string | null {
  const visitMatch = path.match(/^visits\[([^\]]+)\]\./);
  if (visitMatch) return `unit:${visitMatch[1]}`;

  const goalMatch = path.match(/^goals\[([^\]]+)\]\./);
  if (goalMatch) {
    const gid = goalMatch[1];
    for (const [uid, meta] of policy.bundled) {
      if (meta.goalId === gid) return uid;
    }
  }

  const apptMatch = path.match(/^appointments\[([^\]]+)\]\./);
  if (apptMatch) {
    const aid = apptMatch[1];
    for (const [uid, meta] of policy.bundled) {
      if (meta.apptIds.includes(aid)) return uid;
    }
  }
  return null;
}

function classify(base: unknown, local: unknown, remote: unknown): TriadStatus {
  const lb = eqValue(local, base);
  const rb = eqValue(remote, base);
  if (lb && rb) return 'unchanged';
  if (!lb && rb) return 'local-only';
  if (lb && !rb) return 'remote-only';
  if (eqValue(local, remote)) return 'same-both';
  return 'conflict';
}

/** 三方比较 + 按协作粒度形成裁决项 */
export function analyzeMerge(
  caseId: string,
  base: CaseFile,
  local: CaseFile,
  remote: CaseFile,
  granularity: 'field' | 'unit',
): MergeAnalysis {
  const policy = buildPolicy([base, local, remote]);

  const fb = flatten(base);
  const fl = flatten(local);
  const fr = flatten(remote);
  const allPaths = new Set<string>([...fb.keys(), ...fl.keys(), ...fr.keys()]);

  const paths: PathDiff[] = [];
  for (const path of allPaths) {
    const b = fb.get(path);
    const l = fl.get(path);
    const r = fr.get(path);
    const status = classify(b, l, r);
    paths.push({
      path,
      label: path,
      groupId: policy.corrOf.get(path) ?? null,
      unitId: unitMembership(path, policy),
      base: b,
      local: l,
      remote: r,
      status,
      changed: status !== 'unchanged',
    });
  }

  const changed = paths.filter((p) => p.changed);
  const items: MergeItem[] = [];
  const consumed = new Set<string>();
  const autoNotes: string[] = [];

  if (granularity === 'field') {
    // 1) 关联状态组：整体拦截
    const groupIds = new Set<string>();
    for (const p of changed) if (p.groupId) groupIds.add(p.groupId);
    for (const gid of groupIds) {
      const groupPaths = paths.filter((p) => p.groupId === gid).map((p) => p.path);
      for (const p of groupPaths) consumed.add(p);
      const item = makeItem(
        gid,
        'correlated',
        `互相关联状态必须整体裁决（${groupPaths.length} 个字段）`,
        '服务目标发布状态与到访记录状态、履约结论构成不变量：不能只合并其中一半，否则可能越过主管退回或产生自相矛盾的计划状态。',
        groupPaths,
        paths,
      );
      items.push(item);
    }

    // 2) 其余每个变化字段独立成项
    for (const p of changed) {
      if (consumed.has(p.path)) continue;
      const item = makeItem(
        `field:${p.path}`,
        'independent',
        p.path,
        '独立字段：可与其他字段的修改同时保留。',
        [p.path],
        paths,
      );
      items.push(item);
    }
  } else {
    // unit 粒度：每个家访单元一个整包裁决项
    const unitIds = new Set<string>();
    for (const p of changed) if (p.unitId) unitIds.add(p.unitId);
    for (const uid of unitIds) {
      const unitPaths = paths.filter((p) => p.unitId === uid).map((p) => p.path);
      for (const p of unitPaths) consumed.add(p);
      const item = makeItem(
        uid,
        'unit',
        `整次家访确认单元（${unitPaths.length} 个字段，含完整上下文）`,
        '主管将一次看到观察、时长、履约、目标状态与被捆绑的未来预约；在整包裁决前，包内所有改动（包括无关的约访调整）都不会单独生效。',
        unitPaths,
        paths,
      );
      items.push(item);
    }
    // 不属于任何单元的变化（如档案、其他预约）仍按独立字段处理
    for (const p of changed) {
      if (consumed.has(p.path)) continue;
      items.push(
        makeItem(
          `field:${p.path}`,
          'independent',
          p.path,
          '不属于家访单元的独立字段。',
          [p.path],
          paths,
        ),
      );
    }
  }

  // 自动合并说明
  for (const it of items) {
    if (it.auto === 'auto-local')
      autoNotes.push(`仅本地修改 → 自动保留本地：${it.title.startsWith('field:') ? it.paths[0] : it.title}`);
    if (it.auto === 'auto-remote')
      autoNotes.push(`仅远端修改 → 自动采用远端：${it.title.startsWith('field:') ? it.paths[0] : it.title}`);
  }

  // 排序：待裁决在前，其次按路径
  items.sort((a, b) => {
    if ((a.auto === 'needs-decision') !== (b.auto === 'needs-decision'))
      return a.auto === 'needs-decision' ? -1 : 1;
    return a.paths[0].localeCompare(b.paths[0]);
  });

  return {
    caseId,
    baseRev: base.rev,
    localRev: base.rev,
    remoteRev: remote.rev,
    granularity,
    paths,
    items,
    autoNotes,
  };
}

function makeItem(
  id: string,
  kind: MergeItem['kind'],
  title: string,
  why: string,
  pathList: string[],
  allPaths: PathDiff[],
): MergeItem {
  const rows = pathList
    .map((p) => allPaths.find((x) => x.path === p))
    .filter((x): x is PathDiff => Boolean(x));

  let localTouched = false;
  let remoteTouched = false;
  let hardConflict = false;
  for (const r of rows) {
    if (!r.changed) continue;
    if (r.status === 'local-only') localTouched = true;
    else if (r.status === 'remote-only') remoteTouched = true;
    else if (r.status === 'conflict') {
      localTouched = true;
      remoteTouched = true;
      hardConflict = true;
    } else if (r.status === 'same-both') {
      localTouched = true;
      remoteTouched = true;
    }
  }

  let auto: MergeItem['auto'];
  let decision: Decision | null = null;
  if (!localTouched && remoteTouched) {
    auto = 'auto-remote';
    decision = 'remote';
  } else if (localTouched && !remoteTouched) {
    auto = 'auto-local';
    decision = 'local';
  } else if (localTouched && remoteTouched && !hardConflict && rows.every((r) => r.status === 'same-both' || !r.changed)) {
    auto = 'auto-same';
    decision = 'remote';
  } else if (localTouched && remoteTouched) {
    // 两侧都动过关联组/单元，即使动的是不同子字段，也必须人工整体裁决
    auto = 'needs-decision';
    decision = null;
  } else {
    // 仅有未变化字段被打包（理论上不会创建 item），保守按远端
    auto = 'auto-remote';
    decision = 'remote';
  }

  return {
    id,
    kind,
    title,
    why,
    paths: pathList,
    auto,
    decision,
    manual: {},
  };
}

/** 依据每个裁决项构造候选文档：以远端最新为底，仅套用选择“本地”的项与人工修订 */
export function buildCandidate(
  localRoot: CaseFile,
  remoteRoot: CaseFile,
  analysis: MergeAnalysis,
): CaseFile {
  const candidate: CaseFile = structuredClone(remoteRoot);

  for (const item of analysis.items) {
    const decision = item.decision ?? (item.auto === 'needs-decision' ? null : item.decision);
    if (decision === 'local') {
      for (const p of item.paths) {
        const v = getPath(localRoot, p);
        setPathEnsuringElement(candidate as never, p, structuredClone(v ?? null), localRoot as never);
      }
    }
    // decision === 'remote'：候选已以 remote 为底
    // decision === 'defer'：本次不提交本地值，保留远端值，稍后 rebase 回草稿

    // 人工修订覆盖（仅在非暂缓时）
    if (decision !== 'defer') {
      for (const [p, raw] of Object.entries(item.manual)) {
        if (raw !== undefined) setPathEnsuringElement(candidate as never, p, raw, localRoot as never);
      }
    }
  }
  return candidate;
}

/** 被“暂缓”的项：提交成功后需要把这些本地 hunk rebase 到新版本草稿上 */
export function deferredPaths(analysis: MergeAnalysis): string[] {
  const out: string[] = [];
  for (const item of analysis.items) {
    if (item.decision === 'defer') out.push(...item.paths);
  }
  return out;
}

/** 提交成功后，以新远端为 base，把暂缓的本地修改重新贴回，形成新草稿 */
export function rebaseDeferredOntoNewRemote(
  oldLocal: CaseFile,
  committedRemote: CaseFile,
  analysis: MergeAnalysis,
): CaseFile | null {
  const paths = deferredPaths(analysis);
  if (paths.length === 0) return null;
  const next: CaseFile = structuredClone(committedRemote);
  for (const p of paths) {
    const v = getPath(oldLocal, p);
    setPathEnsuringElement(next as never, p, structuredClone(v ?? null), oldLocal as never);
  }
  return next;
}

/** 统计仍需人工选择而未选择的项 */
export function unresolvedItems(analysis: MergeAnalysis): MergeItem[] {
  return analysis.items.filter((i) => i.auto === 'needs-decision' && i.decision === null);
}
