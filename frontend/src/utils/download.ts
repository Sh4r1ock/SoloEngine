/**
 * @file download.ts
 * @description F6：浏览器下载工具唯一实现
 * - triggerDownload：底层 a 标签触发下载
 * - downloadBlob：Blob 对象下载（LLMConfig 用）
 * - downloadDataURL：dataURL/base64 内容下载（ExcelViewer/OfficeUnavailableViewer/UnsupportedViewer 用）
 * - downloadFromUrl：直接 URL 下载（WordViewer 用）
 */
export const triggerDownload = (href: string, filename: string) => {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
};

export const downloadDataURL = (content: string, filename: string, mime: string) => {
  triggerDownload(content.startsWith('data:') ? content : `data:${mime};base64,${content}`, filename);
};

export const downloadFromUrl = (url: string, filename: string) => {
  triggerDownload(url, filename);
};
