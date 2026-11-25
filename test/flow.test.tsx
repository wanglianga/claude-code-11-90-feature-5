// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppProviders } from '../src/App';
import { apiRemoteScript, ensureSeeded } from '../src/mock/server';

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, '', '/');
  Element.prototype.scrollIntoView = () => {};
});

describe('浏览器全链路（jsdom + fake-indexeddb）', () => {
  it('登录 → 登记 → 远端 rev9 冲突 → 补事实裁决 → 提交成功', async () => {
    await ensureSeeded(true);
    render(<AppProviders />);

    // 登录页：默认已选中 lin.xiao / test1234
    const loginBtn = await screen.findByRole('button', { name: '进入工作台' });
    fireEvent.click(loginBtn);

    // 待访清单出现陈桂兰
    await waitFor(
      () => {
        expect(screen.getAllByText(/陈桂兰/).length).toBeGreaterThan(0);
      },
      { timeout: 6000 },
    );

    // 进入个案（卡片链接 aria-label 含 09:30 陈桂兰）
    const card = document.querySelector('a.visit-card[href*="case-chen"]') as HTMLAnchorElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);

    // 切到到访登记
    const visitTab = await screen.findByRole('tab', { name: /到访登记/ });
    fireEvent.click(visitTab);

    const obs = document.getElementById('obs') as HTMLTextAreaElement;
    expect(obs).toBeTruthy();
    fireEvent.change(obs, { target: { value: obs.value + ' 自动化测试补充：药盒两格未动。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存登记到本机' }));

    await waitFor(() => expect(screen.getByText(/有未同步本地修改/)).toBeTruthy(), { timeout: 4000 });

    // 模拟 B 改约 rev8 + 主管退回 rev9
    await apiRemoteScript({
      actor: { id: 'zhou', name: '周明', role: 'social_worker' },
      tabId: 'tab-B',
      caseId: 'case-chen',
      action: 'reschedule',
      target: 'appt-next',
      summary: 'B 改周三',
      mutate: (c) => {
        c.appointments.find((a) => a.id === 'appt-next')!.startAt = '2026-12-02T10:00:00+08:00';
      },
    });
    await apiRemoteScript({
      actor: { id: 'wang', name: '王敏', role: 'supervisor' },
      tabId: 'tab-W',
      caseId: 'case-chen',
      action: 'supervisor-return',
      target: 'goal-meal',
      summary: '主管退回',
      mutate: (c) => {
        const g = c.goals.find((x) => x.id === 'goal-meal')!;
        g.publishState = 'returned';
        g.returnNote = '请补充药品名称与漏服次数';
        const v = c.visits.find((x) => x.id === 'visit-main')!;
        v.status = 'returned';
      },
    });

    // 点击底部“保存并同步到模拟远端”
    fireEvent.click(screen.getByRole('button', { name: /保存并同步到模拟远端/ }));

    // 自动跳到冲突中心
    const heading = await screen.findByRole('heading', { name: '三方核对中心' }, { timeout: 6000 });
    expect(heading).toBeTruthy();
    expect(await screen.findByText('互相关联字段组 · 整体拦截')).toBeTruthy();

    // 找到关联组卡片，选择“将本地内容作为新版本提交”
    const corrBadge = screen.getByText('互相关联字段组 · 整体拦截');
    const corrCard = corrBadge.closest('.merge-item') as HTMLElement;
    const localRadio = within(corrCard).getByRole('radio', {
      name: /将本地内容作为新版本提交/,
    }) as HTMLInputElement;
    fireEvent.click(localRadio);
    expect(localRadio.checked).toBe(true);

    // 未补事实前提交按钮应被守卫禁用（等待 useMemo 校验）
    const submitBtn = screen.getByRole('button', {
      name: /提交所选项为新版本/,
    }) as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(true));

    // 在人工修订框填写 supplementNote
    const supplementArea = corrCard.querySelector('textarea[id*="supplementNote"]') as HTMLTextAreaElement;
    expect(supplementArea).toBeTruthy();
    fireEvent.change(supplementArea, {
      target: { value: '补充：药盒周一三未动；药名苯磺酸氨氯地平；每周漏服约两次。' },
    });

    await waitFor(() => expect(submitBtn.disabled).toBe(false), { timeout: 4000 });
    fireEvent.click(submitBtn);

    // 成功后回到个案页并出现成功提示
    await waitFor(
      () => {
        expect(screen.getByText(/核对完成，已提交为 rev 10/)).toBeTruthy();
      },
      { timeout: 8000 },
    );
  }, 30000);
});
