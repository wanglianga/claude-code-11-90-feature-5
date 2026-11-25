import type { Actor } from '../types';

// 纯模拟账号，仅存于浏览器，不对应任何真实居民或外部系统。
export const ACCOUNTS: Actor[] = [
  {
    id: 'lin',
    account: 'lin.xiao',
    password: 'test1234',
    name: '林晓',
    title: '社工 · 第三网格',
    role: 'social_worker',
    orgId: 'org-qinghe',
  },
  {
    id: 'zhou',
    account: 'zhou.ming',
    password: 'test1234',
    name: '周明',
    title: '社工 · 第二网格',
    role: 'social_worker',
    orgId: 'org-qinghe',
  },
  {
    id: 'wang',
    account: 'wang.min',
    password: 'test1234',
    name: '王敏',
    title: '服务主管',
    role: 'supervisor',
    orgId: 'org-qinghe',
  },
  {
    id: 'sun',
    account: 'sun.li',
    password: 'test1234',
    name: '孙丽',
    title: '社工 · 新桥第七网格',
    role: 'social_worker',
    orgId: 'org-xinqiao',
  },
];

export function findActor(account: string, password: string): Actor | null {
  const a = ACCOUNTS.find((x) => x.account === account.trim());
  if (!a || a.password !== password) return null;
  return a;
}

export function actorById(id: string | undefined): Actor | undefined {
  return ACCOUNTS.find((a) => a.id === id);
}
