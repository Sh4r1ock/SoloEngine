import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Tabs } from 'antd';
import TerminalView from './TerminalView';

/**
 * 多终端面板（Agentic 操作区 - 终端 tab 内容区）。
 *
 * 需求：创建终端面板时自动创建终端页（不能为空、不能是占位符）；支持创建多个终端。
 *
 * - 打开面板（组件挂载）自动创建第 1 个真实终端（后端 PTY 会话）
 * - 「+」新建终端标签 / 「×」关闭标签（关闭时通知后端销毁 PTY 会话）
 * - 每标签独立 xterm.js + 独立 WebSocket + 独立 PTY 会话（互不干扰）
 * - 标签容器复用 antd Tabs editable-card（与 BrowserPanel 同模式）
 */
interface TerminalTab {
  id: string;
}

interface TerminalPanelProps {
  /**
   * 当前激活终端变化回调（terminal_id = 后端 PTY 会话 ID）。
   * 前端持有"用户正在查看哪个终端"的状态，命令执行目标终端由前端决定并上报，
   * 工具层只接收目标终端 ID 执行——前端与工具联动独立（不写入工具 py）。
   */
  onActiveTerminalChange?: (terminalId: string) => void;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({ onActiveTerminalChange }) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeKey, setActiveKey] = useState<string>('');
  /** 自动创建防重：addTab 为异步，防止 tabs 为空期间 effect 并发触发创建多个终端 */
  const creatingRef = useRef(false);
  /** 首次挂载标记：仅打开面板时自动创建第 1 个终端；用户手动关闭全部标签后不再自动重建 */
  const mountedRef = useRef(false);

  /** 激活终端变化（含首次挂载为空）→ 上报给后端 run_context，供 RunCommand 选择执行终端 */
  useEffect(() => {
    onActiveTerminalChange?.(activeKey);
  }, [activeKey, onActiveTerminalChange]);

  /** 后端创建 PTY 会话，返回 terminal_id */
  const createTerminal = useCallback(async (): Promise<string> => {
    const token = localStorage.getItem('access_token') || '';
    const res = await fetch('/api/v1/terminal/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error(`创建终端会话失败: ${res.status}`);
    }
    const data = await res.json();
    return data.terminal_id;
  }, []);

  /** 新建终端标签 */
  const addTab = useCallback(async () => {
    try {
      const terminalId = await createTerminal();
      setTabs(prev => [...prev, { id: terminalId }]);
      setActiveKey(terminalId);
    } catch (e) {
      console.error('[TerminalPanel] 创建终端失败:', e);
    }
  }, [createTerminal]);

  /** 打开面板自动创建第 1 个终端（不能为空、不能是占位符）；mountedRef 确保仅首次挂载触发，
   *  用户手动关闭全部标签后终端列表保持为空（不自动重建，由用户点 + 新建） */
  useEffect(() => {
    if (mountedRef.current) return;
    if (tabs.length === 0 && !creatingRef.current) {
      mountedRef.current = true;
      creatingRef.current = true;
      addTab().finally(() => {
        creatingRef.current = false;
      });
    }
  }, [tabs.length, addTab]);

  /** 关闭终端标签：通知后端销毁 PTY 会话 */
  const removeTab = useCallback(
    (id: string) => {
      const token = localStorage.getItem('access_token') || '';
      fetch(`/api/v1/terminal/sessions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        // 会话销毁失败不阻塞标签关闭
      });
      setTabs(prev => {
        const idx = prev.findIndex(t => t.id === id);
        const next = prev.filter(t => t.id !== id);
        if (activeKey === id) {
          setActiveKey(next[Math.max(0, idx - 1)]?.id || next[next.length - 1]?.id || '');
        }
        return next;
      });
    },
    [activeKey],
  );

  return (
    <>
      <style>{`
        .hitl-terminal-tabs { flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .hitl-terminal-tabs .ant-tabs { flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .hitl-terminal-tabs .ant-tabs-nav { margin: 0; flex: none; }
        .hitl-terminal-tabs .ant-tabs-content-holder { flex: 1; overflow: hidden; }
        .hitl-terminal-tabs .ant-tabs-content { height: 100%; }
        .hitl-terminal-tabs .ant-tabs-tabpane-active { height: 100%; display: flex; flex-direction: column; }
        /* 标签字体对齐 Agentic 操作区头部标签（编辑器/终端/浏览器/文档）：小号 + 灰/深灰配色，禁用主题色 */
        .hitl-terminal-tabs .ant-tabs-tab { font-size: 12px !important; }
        .hitl-terminal-tabs .ant-tabs-tab-btn { font-size: 12px !important; color: var(--text-300) !important; font-weight: 400 !important; }
        .hitl-terminal-tabs .ant-tabs-tab-active .ant-tabs-tab-btn { color: var(--text-100) !important; font-weight: 500 !important; }
      `}</style>
      <div className="hitl-terminal-tabs">
        <Tabs
          type="editable-card"
          size="small"
          activeKey={activeKey}
          onChange={setActiveKey}
          onEdit={(key, action) => {
            if (action === 'add') addTab();
            else if (typeof key === 'string') removeTab(key);
          }}
          items={tabs.map((t, i) => ({
            key: t.id,
            label: `终端 ${i + 1}`,
            // 始终可关闭（含唯一标签）：关闭后由用户点 + 新建，面板不自动重建
            closable: true,
            children: <TerminalView terminalId={t.id} />,
          }))}
        />
      </div>
    </>
  );
};

export default TerminalPanel;
