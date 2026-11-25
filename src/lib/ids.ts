// 简化的唯一 id 生成（不依赖 crypto.randomUUID 的上下文限制）
let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** 场景脚本需要确定性 id 时使用 */
export function fixedId(prefix: string, n: string): string {
  return `${prefix}-${n}`;
}
