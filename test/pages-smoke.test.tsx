// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppProviders } from '../src/App';
import { ensureSeeded } from '../src/mock/server';

afterEach(() => cleanup());
beforeEach(() => {
  sessionStorage.clear();
  window.location.hash = '';
});

describe('全部页面渲染冒烟', () => {
  it('登录后可访问清单、主管、审计、样例三个标签与授权申请', async () => {
    await ensureSeeded(true);
    render(<AppProviders />);
    fireEvent.click(await screen.findByRole('button', { name: '进入工作台' }));
    await waitFor(() => expect(screen.getAllByText(/陈桂兰/).length).toBeGreaterThan(0), { timeout: 6000 });

    // 主管队列
    fireEvent.click(screen.getByRole('link', { name: /主管确认队列/ }));
    expect(await screen.findByRole('heading', { name: '主管确认队列' })).toBeTruthy();
    // 一键切换主管
    fireEvent.click(screen.getByRole('button', { name: /一键切换为主管/ }));
    await waitFor(() => expect(screen.getByText(/王敏（服务主管）/)).toBeTruthy());

    // 审计页
    fireEvent.click(screen.getByRole('link', { name: /审计日志/ }));
    expect(await screen.findByRole('heading', { name: '审计日志' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.timeline li').length).toBeGreaterThan(0));

    // 样例页
    fireEvent.click(screen.getByRole('link', { name: /样例演练/ }));
    expect(await screen.findByRole('heading', { name: '样例演练与双标签重放' })).toBeTruthy();
    // 默认样例一：逐步脚本与字段级结果（步骤 5 内容需要点到第 6 步才出现？字段级结果在 step>=4 渲染）
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText(/两类合并结果之一：字段级三方比较/)).toBeTruthy();

    // 切到样例二
    fireEvent.click(screen.getByRole('tab', { name: /预约取消/ }));
    expect(screen.getByText(/预约先取消、签到后离线上传/)).toBeTruthy();

    // 切到样例三并申请 20 秒授权
    fireEvent.click(screen.getByRole('tab', { name: /撤权与授权到期/ }));
    expect(await screen.findByText(/真实组件：申请 20 秒授权/)).toBeTruthy();
    const grantBtn = screen.getByRole('button', { name: /授予 20 秒/ });
    fireEvent.click(grantBtn);
    await waitFor(() => expect(screen.getByText(/授权有效/)).toBeTruthy(), { timeout: 6000 });
    // 真值出现
    expect(screen.getByText(/139-0000-2046/)).toBeTruthy();
    // RestrictedContact 区域存在撤权按钮
    expect(screen.getByRole('button', { name: /模拟家属撤权/ })).toBeTruthy();

    // 个案页各 tab 也渲染一次
    window.location.hash = '#/case/case-liang';
    await waitFor(() => expect(screen.getByRole('heading', { name: /梁广生/ })).toBeTruthy(), { timeout: 4000 });
    for (const name of ['目标与计划', '预约管理', '转介与提醒', '同步记录']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      // 每个面板至少渲染出卡片或标题；点击不抛错即通过
      await new Promise((r) => setTimeout(r, 30));
    }
    // 回到概览，受限组件应在无授权状态下渲染遮蔽块
    fireEvent.click(screen.getByRole('tab', { name: /概览与授权/ }));
    await waitFor(() => expect(document.querySelector('.secret-box .masked')).toBeTruthy());
  }, 40000);

  it('样例页提供一键布置与双标签入口', async () => {
    await ensureSeeded(true);
    render(<AppProviders />);
    fireEvent.click(await screen.findByRole('button', { name: '进入工作台' }));
    await waitFor(() => expect(screen.getAllByText(/陈桂兰/).length).toBeGreaterThan(0), { timeout: 6000 });
    const scenarioLinks = screen.getAllByRole('link', { name: /样例演练/ });
    fireEvent.click(scenarioLinks[0]);
    expect(await screen.findByRole('button', { name: /植入 A 草稿并打开字段级冲突中心/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /开标签 A · 林晓/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /开主管标签 · 王敏/ })).toBeTruthy();
  }, 20000);

  it('迁居移交样例可切换两种方式回放，C-21 个案页可打开移交面板', async () => {
    await ensureSeeded(true);
    render(<AppProviders />);
    fireEvent.click(await screen.findByRole('button', { name: '进入工作台' }));
    await waitFor(() => expect(screen.getAllByText(/陈桂兰/).length).toBeGreaterThan(0), { timeout: 6000 });

    // 样例页 → 第四个样例
    fireEvent.click(screen.getAllByRole('link', { name: /样例演练/ })[0]);
    fireEvent.click(await screen.findByRole('tab', { name: /迁居移交 × 唯一跟进责任/ }));
    expect(await screen.findByText(/样例 C-21 · 长者迁居后的唯一跟进责任/)).toBeTruthy();
    expect(screen.getAllByText(/唯一跟进责任机构/).length).toBeGreaterThan(0);

    // 切换到迁入日转给新机构
    fireEvent.click(screen.getByRole('button', { name: /按迁入日转给新机构回放/ }));
    await waitFor(() => expect(screen.getByText(/逐步回放 · 迁入日转给新机构/)).toBeTruthy());
    expect(screen.getAllByText(/迟到同步/).length).toBeGreaterThan(0);

    // 打开 C-21 个案页并切到“迁居移交”标签
    window.location.hash = '#/case/case-c21';
    await waitFor(() => expect(screen.getByRole('heading', { name: /卢凤仪/ })).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByRole('tab', { name: /迁居移交/ }));
    expect(await screen.findByText(/迁居移交概况/)).toBeTruthy();
    expect(screen.getAllByText(/清河街道综合服务中心/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/RH-4/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /重复送达同一退回回执/ })).toBeTruthy();
    // 历史归属面板
    expect(screen.getByText(/已完成家访的历史归属/)).toBeTruthy();
  }, 40000);

  it('C-21 移交面板：写入唯一责任 → 服务方退回生成任务 → 重复回执不新增催办', async () => {
    await ensureSeeded(true);
    render(<AppProviders />);
    fireEvent.click(await screen.findByRole('button', { name: '进入工作台' }));
    await waitFor(() => expect(screen.getAllByText(/陈桂兰/).length).toBeGreaterThan(0), { timeout: 6000 });

    window.location.hash = '#/case/case-c21';
    await waitFor(() => expect(screen.getByRole('heading', { name: /卢凤仪/ })).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByRole('tab', { name: /迁居移交/ }));
    expect(await screen.findByText(/迁居移交概况/)).toBeTruthy();

    // 选择迁入日转给新机构并写入唯一责任
    const policyRadio = document.querySelector(
      'input[name="transfer-policy"] ~ *',
    ) as HTMLElement | null;
    void policyRadio;
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="transfer-policy"]');
    expect(radios.length).toBe(2);
    fireEvent.click(radios[1]);
    fireEvent.click(screen.getByRole('button', { name: /确认移交方式并写入唯一跟进责任/ }));

    await waitFor(() => expect(screen.getByText(/已生效/)).toBeTruthy(), { timeout: 5000 });
    expect(screen.getAllByText(/孙丽/).length).toBeGreaterThan(0);
    expect(screen.getByText(/下一动作/)).toBeTruthy();

    // 服务方退回 → 出现一条补齐任务
    fireEvent.click(screen.getByRole('button', { name: /模拟服务方 06-02 10:00 退回/ }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: /标记已补齐并联系服务方/ })).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(screen.getAllByText(/截止 2026-06-05/).length).toBeGreaterThan(0);

    // 重复送达同一回执 → 仍只有一条任务
    fireEvent.click(screen.getByRole('button', { name: /重复送达同一退回回执/ }));
    await waitFor(
      () => expect(screen.getByText(/重复送达的服务方回执/)).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(screen.getAllByRole('button', { name: /标记已补齐并联系服务方/ })).toHaveLength(1);
  }, 40000);
});
