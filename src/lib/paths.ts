// 把聚合文档扁平化为 “a.b[elementId].field” 叶子路径，供字段级三方比较。
// 约定：对象数组必须含字符串 id，按 id 寻址；原始值数组整体作为叶子。

export type Token = { t: 'key'; k: string } | { t: 'id'; id: string };

const TOKEN_RE = /([^.[\]]+)|\[([^\]]+)\]/g;

export function parsePath(path: string): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push({ t: 'key', k: m[1] });
    else if (m[2] !== undefined) tokens.push({ t: 'id', id: m[2] });
  }
  return tokens;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasStringId(v: unknown): v is { id: string } {
  return isPlainObject(v) && typeof v.id === 'string';
}

export function flatten(root: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  walk(root, '', out);
  return out;
}

function walk(value: unknown, path: string, out: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(hasStringId)) {
      for (const el of value) {
        walk(el, `${path}[${el.id}]`, out);
      }
    } else {
      // 原始值数组（如未完成原因）或无 id 对象数组：整体比较
      out.set(path, value);
    }
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.set(path, {});
      return;
    }
    for (const k of keys) {
      const next = path ? `${path}.${k}` : k;
      walk(value[k], next, out);
    }
    return;
  }
  out.set(path, value);
}

export function getPath<T = unknown>(root: unknown, path: string): T | undefined {
  const tokens = parsePath(path);
  let cur: unknown = root;
  for (const tok of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (tok.t === 'key') {
      if (!isPlainObject(cur)) return undefined;
      cur = cur[tok.k];
    } else {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find((x) => hasStringId(x) && x.id === tok.id);
    }
  }
  return cur as T;
}

/** 深度相等（数组/对象按 JSON 结构比较，原始值按 Object.is） */
export function eqValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 在 target（将被就地修改的克隆）上设置叶子路径；若数组元素不存在则从 fallbackRoot 拷贝整个元素 */
export function setPathEnsuringElement(
  target: unknown,
  path: string,
  value: unknown,
  fallbackRoot?: unknown,
): void {
  const tokens = parsePath(path);
  if (tokens.length === 0) return;
  let cur: any = target;

  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i];
    if (tok.t === 'key') {
      if (cur[tok.k] === undefined || cur[tok.k] === null) cur[tok.k] = {};
      cur = cur[tok.k];
    } else {
      if (!Array.isArray(cur)) return;
      let el = cur.find((x: any) => x && x.id === tok.id);
      if (!el) {
        // 远端没有这个元素（典型：本地离线新增的转介），从本地根复制整个元素
        const fb = fallbackRoot ? getPath(fallbackRoot, pathUpTo(tokens, i)) : undefined;
        if (fb && typeof fb === 'object') {
          el = structuredClone(fb);
          cur.push(el);
        } else {
          el = { id: tok.id };
          cur.push(el);
        }
      }
      cur = el;
    }
  }

  const last = tokens[tokens.length - 1];
  if (last.t === 'key') {
    cur[last.k] = value;
  } else {
    if (!Array.isArray(cur)) return;
    const idx = cur.findIndex((x: any) => x && x.id === last.id);
    if (idx >= 0) cur[idx] = value;
    else cur.push(value);
  }
}

function pathUpTo(tokens: Token[], idxInclusive: number): string {
  let p = '';
  for (let i = 0; i <= idxInclusive; i++) {
    const tk = tokens[i];
    if (tk.t === 'key') p += p ? `.${tk.k}` : tk.k;
    else p += `[${tk.id}]`;
  }
  return p;
}

/** 取某路径的“集合元素”前缀，例如 visits[v1].observations -> visits[v1] */
export function elementPrefix(path: string): string | null {
  const firstId = path.indexOf('[');
  if (firstId < 0) return null;
  const close = path.indexOf(']', firstId);
  return path.slice(0, close + 1);
}
