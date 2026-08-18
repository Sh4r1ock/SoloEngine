import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/**
 * 单个真实终端（xterm.js + WebSocket + 后端 PTY）。
 *
 * - 前端 xterm.js（VS Code 同款终端模拟器）
 * - 后端 pywinpty 会话经 WebSocket 双向 I/O：
 *   term.onData -> ws {type:"input"} -> pty.write
 *   pty.read(daemon线程) -> ws {type:"output"} -> term.write
 * - FitAddon 自适应容器尺寸；ResizeObserver 监听容器变化重新 fit
 *   （规避多标签切换时隐藏 pane 导致终端收缩为 0 的已知坑）
 */
interface TerminalViewProps {
  /** 后端 PTY 会话 id（由 TerminalPanel 创建并持有） */
  terminalId: string;
}

const TerminalView: React.FC<TerminalViewProps> = ({ terminalId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 初始化 xterm.js 终端
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#cccccc',
        selectionBackground: '#264f78',
      },
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    try {
      fitAddon.fit();
    } catch (e) {
      // 容器未就绪时忽略
    }
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // WebSocket 连接后端 PTY
    const token = localStorage.getItem('access_token') || '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const isDev = host.includes(':8991');
    const wsHost = isDev ? 'localhost:8990' : host;
    const wsUrl = `${protocol}//${wsHost}/api/v1/terminal/ws/${terminalId}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // 连接建立后同步终端尺寸
      try {
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      } catch (e) {
        // ignore
      }
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[90m[进程已退出, code: ${msg.code}]\x1b[0m\r\n`);
        }
      } catch (e) {
        // 非 JSON 消息忽略
      }
    };
    ws.onclose = () => {
      try {
        term.write('\r\n\x1b[90m[连接已断开]\x1b[0m\r\n');
      } catch (e) {
        // ignore
      }
    };

    // 键盘输入 -> WS -> PTY
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    // 终端尺寸变化 -> WS -> pty.set_size
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // 容器尺寸变化时重新 fit（多标签切换/面板拉伸时保证终端填满）
    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch (e) {
        // ignore
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch (e) {
        // ignore
      }
      term.dispose();
      termRef.current = null;
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minHeight: 0, padding: 6, background: '#1e1e1e', overflow: 'hidden' }}
    />
  );
};

export default TerminalView;
