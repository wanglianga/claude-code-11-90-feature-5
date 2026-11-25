// 时间与展示格式化。场景固定日期为 2026-11-25（周三），容器当前日期也恰为该日。

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function iso(y: number, m: number, d: number, hh = 9, mm = 0): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00+08:00`;
}

export function hm(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function mdWeek(isoStr: string): string {
  const d = new Date(isoStr);
  const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weeks[d.getDay()]}`;
}

export function fullTime(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function toLocalInputValue(isoStr: string | null): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromLocalInputValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 授权剩余时间文案 */
export function remainLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return '已到期';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} 秒后到期`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min} 分钟后到期`;
  const h = Math.floor(min / 60);
  return `${h} 小时 ${min % 60} 分后到期`;
}
