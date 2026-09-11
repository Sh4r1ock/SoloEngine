/**
 * @file utils/dataBlockUtils.ts
 * @description 数据块处理工具函数（仅保留活路径 copyToClipboard）
 */

/**
 * 将文本写入系统剪贴板，确保 Windows 剪贴板历史(Win+V)能正确捕获。
 *
 * 原理：execCommand('copy') 走 WM_COPY → SetClipboardData → WM_CLIPBOARDUPDATE
 * 传统路径，与 Ctrl+C 完全一致，Windows 剪贴板历史服务一定能捕获。
 *
 * 注：navigator.clipboard.write() / writeText() 使用 Chromium 内部 HWND 作为
 * clipboard owner，Windows 剪贴板历史服务不识别该 owner，导致 Win+V 不记录。
 */
export const copyToClipboard = (text: string): boolean => {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
};
