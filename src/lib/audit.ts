import type { AuditEntry } from '../types';

/** 审计条目内容指纹（模拟防篡改校验位；非区块链，仅用于演示可核对） */
export async function fingerprint(entry: object): Promise<string> {
  const data = JSON.stringify(entry);
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 20);
    }
  } catch {
    // 落到非 subtle 环境时使用 FNV 风格兜底
  }
  let h1 = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h1 ^= data.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `fnv-${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}
