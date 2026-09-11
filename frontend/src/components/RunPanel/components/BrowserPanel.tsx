import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, Typography, Tooltip, Tabs } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined, GlobalOutlined } from '@ant-design/icons';
import { useRunPanelStore } from '../stores/runPanelStore';

const { Text } = Typography;

/** 规范化网址：无协议时补 http:// */
const normalizeUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
};

/** 标签标题：URL 的 host（如 localhost:3000），无 URL 时显示"新标签页" */
const getTitle = (url: string | null): string => {
  if (!url) return '新标签页';
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** 代理路径前缀（与后端 /browser-proxy/{scheme}/{host}{path} 约定一致） */
const PROXY_PREFIX = '/browser-proxy/';

/**
 * 真实 URL -> 同源代理 URL（iframe 实际加载地址）。
 * 例：http://localhost:3000/_db_read.py
 *   -> http://localhost:8991/browser-proxy/http/localhost:3000/_db_read.py
 * iframe 全程同源，父页面才能读取其 location 并操作其 history。
 */
const toProxyUrl = (real: string): string => {
  const u = new URL(real);
  return `${window.location.origin}${PROXY_PREFIX}${u.protocol.replace(':', '')}/${u.host}${u.pathname}${u.search}${u.hash}`;
};

/** 同源代理 URL -> 真实 URL（地址栏显示）。 */
const fromProxyUrl = (proxy: string): string => {
  const idx = proxy.indexOf(PROXY_PREFIX);
  if (idx === -1) return proxy;
  const rest = proxy.slice(idx + PROXY_PREFIX.length);
  const slash1 = rest.indexOf('/');
  if (slash1 === -1) return proxy;
  const scheme = rest.slice(0, slash1);
  const rest2 = rest.slice(slash1 + 1);
  const slash2 = rest2.indexOf('/');
  if (slash2 === -1) return `${scheme}://${rest2}`;
  return `${scheme}://${rest2.slice(0, slash2)}${rest2.slice(slash2)}`;
};

interface BrowserTab {
  id: string;
  /** 地址栏显示的真实 URL（iframe 内部导航后由轮询/事件同步更新） */
  url: string | null;
  /** iframe 实际加载的同源代理地址（仅外部导航时更新，内部导航不改变） */
  src: string | null;
  /** 刷新信号：iframe key 变化触发重新挂载 = 重载（同 URL 外部导航时使用） */
  refreshKey: number;
  /** 真实 URL 历史栈（外部导航与 iframe 内部导航共用） */
  history: string[];
  /** 历史栈当前索引（-1 表示无历史） */
  historyIndex: number;
}

let tabSeq = 0;
const newTabId = () => `btab-${++tabSeq}`;

/**
 * 单个标签的浏览器外壳（网址栏 + 后退/前进/刷新 + iframe）。
 *
 * iframe 通过 /browser-proxy 同源加载目标站点后：
 * - 地址栏：轮询 + popstate/hashchange 监听 iframe 内部 location，同步显示真实 URL
 * - 前进/后退：由 React 层维护历史栈（history/historyIndex）驱动 iframe 重载，
 *   不调用 iframe 原生 history API——同源 iframe 与父页面共享 session history，
 *   而外部导航（src 变化重挂载）不产生 iframe 内部历史条目，
 *   直接调用 history.back() 会在 iframe 无内部历史时误回退父页面路由
 * - 刷新：refreshKey 变化触发 iframe 重挂载（不新增历史条目）
 * - 内部导航（点击链接/JS 跳转）由 iframe 自己完成，轮询同步时并入 React 历史栈
 */
const BrowserView: React.FC<{
  tab: BrowserTab;
  onNavigate: (url: string) => void;
  onUrlChange: (realUrl: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onRefresh: () => void;
}> = ({ tab, onNavigate, onUrlChange, onGoBack, onGoForward, onRefresh }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [urlInput, setUrlInput] = useState(tab.url || '');

  // 网址栏同步当前 URL（外部导航 / 内部导航轮询同步后）
  useEffect(() => {
    setUrlInput(tab.url || '');
  }, [tab.url]);

  // 轮询 iframe 内部 location（同源代理后可用），检测内部导航并同步地址栏
  useEffect(() => {
    const sync = () => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      try {
        const loc = iframe.contentWindow?.location?.href;
        if (loc) {
          const real = fromProxyUrl(loc);
          if (real && real !== tab.url) onUrlChange(real);
        }
      } catch {
        // 跨源（未代理地址）或加载中无法读取，跳过
      }
    };
    const iv = window.setInterval(sync, 400);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.url]);

  // iframe 内部 popstate/hashchange（同源后可用）：内部前进/后退/哈希跳转立即同步地址栏
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const sync = () => {
      try {
        const real = fromProxyUrl(win.location.href);
        if (real && real !== tab.url) onUrlChange(real);
      } catch {
        // ignore
      }
    };
    win.addEventListener('popstate', sync);
    win.addEventListener('hashchange', sync);
    return () => {
      win.removeEventListener('popstate', sync);
      win.removeEventListener('hashchange', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.url, tab.src]);

  const onUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onNavigate(urlInput);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 浏览器 chrome：后退 / 前进 / 刷新 + 网址栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--bg-300)', background: 'var(--bg-200)' }}>
        <Tooltip title="后退">
          <Button type="text" size="small" icon={<ArrowLeftOutlined />} disabled={!tab.url || tab.historyIndex <= 0} onClick={onGoBack} />
        </Tooltip>
        <Tooltip title="前进">
          <Button type="text" size="small" icon={<ArrowRightOutlined />} disabled={!tab.url || tab.historyIndex >= tab.history.length - 1} onClick={onGoForward} />
        </Tooltip>
        <Tooltip title="刷新">
          <Button type="text" size="small" icon={<ReloadOutlined />} disabled={!tab.url} onClick={onRefresh} />
        </Tooltip>
        <Input
          size="small"
          prefix={<GlobalOutlined style={{ color: 'var(--text-300)', fontSize: 12 }} />}
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onPressEnter={onUrlKeyDown}
          placeholder="输入网址后回车访问"
          style={{ flex: 1, background: 'var(--bg-100)' }}
        />
      </div>
      {/* 内容区：iframe（同源代理加载，key 变化触发重新挂载 = 同 URL 刷新重载） */}
      {tab.src ? (
        <iframe
          key={`${tab.src}-${tab.refreshKey}`}
          ref={iframeRef}
          src={tab.src}
          title="浏览器预览"
          style={{ flex: 1, width: '100%', border: 'none', background: 'var(--bg-100)' }}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>输入网址或点击预览打开页面</Text>
        </div>
      )}
    </div>
  );
};

/**
 * 多标签浏览器面板（Agentic 操作区 - 浏览器 tab 内容区）。
 *
 * 标签栏使用项目现有框架 antd Tabs（editable-card，支持新建/关闭/切换），
 * 每个标签复用浏览器外壳（BrowserView：网址栏 + 后退/前进/刷新 + iframe），
 * 每标签独立 iframe 与同源代理地址；OpenPreview 可跳转块点击（browserNavSeq 信号）
 * 在当前激活标签导航。
 */
const BrowserPanel: React.FC = () => {
  const browserUrl = useRunPanelStore(s => s.browserUrl);
  // 外部导航信号：OpenPreview 可跳转块每次点击都递增（即使 URL 相同），
  // 依赖信号而非 URL 值，解决"重复点击同一 URL 不触发导航"的问题。
  const browserNavSeq = useRunPanelStore(s => s.browserNavSeq);

  const initialTabIdRef = useRef(newTabId());
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [
    { id: initialTabIdRef.current, url: null, src: null, refreshKey: 0, history: [], historyIndex: -1 },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTabIdRef.current);

  const navigateTab = useCallback((tabId: string, url: string) => {
    const target = normalizeUrl(url);
    if (!target) return;
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const nextSrc = toProxyUrl(target);
      // 同 URL 外部导航 = 刷新（refreshKey 变化触发 iframe 重挂载重载，不新增历史条目）
      if (nextSrc === t.src && t.url === target) {
        return { ...t, refreshKey: t.refreshKey + 1 };
      }
      // 前进方向截断：丢弃 index 之后的旧前进历史，再追加新条目
      const history = [...t.history.slice(0, t.historyIndex + 1), target];
      return { ...t, url: target, src: nextSrc, history, historyIndex: history.length - 1 };
    }));
  }, []);

  /** 地址栏同步（iframe 内部导航后更新显示 URL；并入 React 历史栈，不改变 src） */
  const updateTabUrl = useCallback((tabId: string, realUrl: string) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId || t.url === realUrl) return t;
      // iframe 加载/重挂载过程中的初始 about:blank 与非法协议（about:/data:/javascript: 等）
      // 不是真实导航，不并入历史栈——否则会污染历史导致后退异常
      if (!realUrl || !/^https?:/i.test(realUrl)) return t;
      // iframe 内部导航（点击链接/JS 跳转）：前进方向截断后并入历史栈
      const history = [...t.history.slice(0, t.historyIndex + 1), realUrl];
      return { ...t, url: realUrl, history, historyIndex: history.length - 1 };
    }));
  }, []);

  /** 后退：React 历史栈回退（重新设置 iframe src 重载，不触碰 iframe 原生 history） */
  const handleGoBack = useCallback((tabId: string) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId || t.historyIndex <= 0) return t;
      const newIndex = t.historyIndex - 1;
      const target = t.history[newIndex];
      return { ...t, url: target, src: toProxyUrl(target), historyIndex: newIndex, refreshKey: t.refreshKey + 1 };
    }));
  }, []);

  /** 前进：React 历史栈前进（重新设置 iframe src 重载） */
  const handleGoForward = useCallback((tabId: string) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId || t.historyIndex >= t.history.length - 1) return t;
      const newIndex = t.historyIndex + 1;
      const target = t.history[newIndex];
      return { ...t, url: target, src: toProxyUrl(target), historyIndex: newIndex, refreshKey: t.refreshKey + 1 };
    }));
  }, []);

  /** 刷新：refreshKey 变化触发 iframe 重挂载重载（不新增历史条目） */
  const handleRefresh = useCallback((tabId: string) => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, refreshKey: t.refreshKey + 1 } : t)));
  }, []);

  const addTab = useCallback(() => {
    const id = newTabId();
    setTabs(prev => [...prev, { id, url: null, src: null, refreshKey: 0, history: [], historyIndex: -1 }]);
    setActiveTabId(id);
  }, []);

  const removeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  }, [activeTabId]);

  // 外部导航信号（OpenPreview 点击）：在当前激活标签导航到 browserUrl
  useEffect(() => {
    if (browserUrl) {
      navigateTab(activeTabId, browserUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserNavSeq]);

  return (
    <>
      <style>{`
        .hitl-browser-tabs { flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .hitl-browser-tabs .ant-tabs { flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .hitl-browser-tabs .ant-tabs-nav { margin: 0; flex: none; }
        .hitl-browser-tabs .ant-tabs-content-holder { flex: 1; overflow: hidden; }
        .hitl-browser-tabs .ant-tabs-content { height: 100%; }
        .hitl-browser-tabs .ant-tabs-tabpane-active { height: 100%; display: flex; flex-direction: column; }
        /* 标签字体对齐 Agentic 操作区头部标签（编辑器/终端/浏览器/文档）：小号 + 灰/深灰配色，禁用主题色 */
        .hitl-browser-tabs .ant-tabs-tab { font-size: 12px !important; }
        .hitl-browser-tabs .ant-tabs-tab-btn { font-size: 12px !important; color: var(--text-300) !important; font-weight: 400 !important; }
        .hitl-browser-tabs .ant-tabs-tab-active .ant-tabs-tab-btn { color: var(--text-100) !important; font-weight: 500 !important; }
      `}</style>
      <div className="hitl-browser-tabs">
        <Tabs
          type="editable-card"
          size="small"
          activeKey={activeTabId}
          onChange={setActiveTabId}
          onEdit={(key, action) => {
            if (action === 'add') addTab();
            else if (typeof key === 'string') removeTab(key);
          }}
          items={tabs.map(t => ({
            key: t.id,
            label: getTitle(t.url),
            closable: tabs.length > 1,
            children: (
              <BrowserView
                tab={t}
                onNavigate={(url) => navigateTab(t.id, url)}
                onUrlChange={(real) => updateTabUrl(t.id, real)}
                onGoBack={() => handleGoBack(t.id)}
                onGoForward={() => handleGoForward(t.id)}
                onRefresh={() => handleRefresh(t.id)}
              />
            ),
          }))}
        />
      </div>
    </>
  );
};

export default BrowserPanel;
