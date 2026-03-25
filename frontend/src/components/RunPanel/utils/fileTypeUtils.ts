import type { FileCategory, FileTypeInfo } from '../types';

export const getFileExtension = (fileName: string): string => {
  return fileName.split('.').pop()?.toLowerCase() || '';
};

export const getFileTypeInfo = (fileName: string): FileTypeInfo => {
  const ext = getFileExtension(fileName);
  const FILE_TYPE_MAP: Record<string, FileTypeInfo> = {
    js: { category: 'code', language: 'javascript', editable: true, viewer: 'CodeEditor' },
    jsx: { category: 'code', language: 'javascript', editable: true, viewer: 'CodeEditor' },
    ts: { category: 'code', language: 'typescript', editable: true, viewer: 'CodeEditor' },
    tsx: { category: 'code', language: 'typescript', editable: true, viewer: 'CodeEditor' },
    py: { category: 'code', language: 'python', editable: true, viewer: 'CodeEditor' },
    java: { category: 'code', language: 'java', editable: true, viewer: 'CodeEditor' },
    c: { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
    cpp: { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
    h: { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
    hpp: { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
    go: { category: 'code', language: 'go', editable: true, viewer: 'CodeEditor' },
    rs: { category: 'code', language: 'rust', editable: true, viewer: 'CodeEditor' },
    rb: { category: 'code', language: 'ruby', editable: true, viewer: 'CodeEditor' },
    php: { category: 'code', language: 'php', editable: true, viewer: 'CodeEditor' },
    cs: { category: 'code', language: 'csharp', editable: true, viewer: 'CodeEditor' },
    swift: { category: 'code', language: 'swift', editable: true, viewer: 'CodeEditor' },
    kt: { category: 'code', language: 'kotlin', editable: true, viewer: 'CodeEditor' },
    vue: { category: 'code', language: 'vue', editable: true, viewer: 'CodeEditor' },
    svelte: { category: 'code', language: 'html', editable: true, viewer: 'CodeEditor' },
    css: { category: 'code', language: 'css', editable: true, viewer: 'CodeEditor' },
    scss: { category: 'code', language: 'scss', editable: true, viewer: 'CodeEditor' },
    less: { category: 'code', language: 'less', editable: true, viewer: 'CodeEditor' },
    html: { category: 'code', language: 'html', editable: true, viewer: 'CodeEditor' },
    xml: { category: 'code', language: 'xml', editable: true, viewer: 'CodeEditor' },
    json: { category: 'code', language: 'json', editable: true, viewer: 'CodeEditor' },
    yaml: { category: 'code', language: 'yaml', editable: true, viewer: 'CodeEditor' },
    yml: { category: 'code', language: 'yaml', editable: true, viewer: 'CodeEditor' },
    sh: { category: 'code', language: 'shell', editable: true, viewer: 'CodeEditor' },
    bash: { category: 'code', language: 'shell', editable: true, viewer: 'CodeEditor' },
    ps1: { category: 'code', language: 'powershell', editable: true, viewer: 'CodeEditor' },
    bat: { category: 'code', language: 'batch', editable: true, viewer: 'CodeEditor' },
    sql: { category: 'code', language: 'sql', editable: true, viewer: 'CodeEditor' },
    ini: { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
    conf: { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
    cfg: { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
    env: { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
    toml: { category: 'code', language: 'toml', editable: true, viewer: 'CodeEditor' },
    md: { category: 'markdown', editable: true, viewer: 'MarkdownEditor' },
    markdown: { category: 'markdown', editable: true, viewer: 'MarkdownEditor' },
    docx: { category: 'office', editable: true, viewer: 'OnlyOfficeEditor', fallbackViewer: 'WordViewer' },
    doc: { category: 'office', editable: true, viewer: 'OnlyOfficeEditor', requiresOnlyOffice: true },
    xlsx: { category: 'office', editable: true, viewer: 'OnlyOfficeEditor', fallbackViewer: 'ExcelViewer' },
    xls: { category: 'office', editable: true, viewer: 'OnlyOfficeEditor', fallbackViewer: 'ExcelViewer' },
    csv: { category: 'office', editable: true, viewer: 'OnlyOfficeEditor', fallbackViewer: 'ExcelViewer' },
    pptx: { category: 'office', editable: true, viewer: 'OnlyOfficeEditor', fallbackViewer: 'PPTViewer' },
    ppt: { category: 'office', editable: true, viewer: 'OnlyOfficeEditor', requiresOnlyOffice: true },
    pdf: { category: 'pdf', editable: false, viewer: 'PDFViewer' },
    png: { category: 'image', editable: false, viewer: 'ImageViewer' },
    jpg: { category: 'image', editable: false, viewer: 'ImageViewer' },
    jpeg: { category: 'image', editable: false, viewer: 'ImageViewer' },
    gif: { category: 'image', editable: false, viewer: 'ImageViewer' },
    bmp: { category: 'image', editable: false, viewer: 'ImageViewer' },
    ico: { category: 'image', editable: false, viewer: 'ImageViewer' },
    webp: { category: 'image', editable: false, viewer: 'ImageViewer' },
    svg: { category: 'image', editable: false, viewer: 'ImageViewer' },
    txt: { category: 'text', editable: true, viewer: 'TextViewer' },
    log: { category: 'text', editable: true, viewer: 'TextViewer' },
  };
  
  return FILE_TYPE_MAP[ext] || { category: 'unsupported', editable: false, viewer: 'UnsupportedViewer' };
};

export const getFileCategory = (fileName: string): FileCategory => {
  return getFileTypeInfo(fileName).category;
};

export const isEditable = (fileName: string): boolean => {
  return getFileTypeInfo(fileName).editable;
};

export const getLanguage = (fileName: string): string | undefined => {
  return getFileTypeInfo(fileName).language;
};

export const getViewerName = (fileName: string): string => {
  return getFileTypeInfo(fileName).viewer;
};

export const requiresOnlyOffice = (fileName: string): boolean => {
  return getFileTypeInfo(fileName).requiresOnlyOffice ?? false;
};

export const getFallbackViewer = (fileName: string): string | undefined => {
  return getFileTypeInfo(fileName).fallbackViewer;
};

export const isOfficeFile = (fileName: string): boolean => {
  const category = getFileCategory(fileName);
  return category === 'office';
};

export const isCodeFile = (fileName: string): boolean => {
  const category = getFileCategory(fileName);
  return category === 'code';
};

export const isMarkdownFile = (fileName: string): boolean => {
  const category = getFileCategory(fileName);
  return category === 'markdown';
};

export const isImageFile = (fileName: string): boolean => {
  const category = getFileCategory(fileName);
  return category === 'image';
};

export const isPDFFile = (fileName: string): boolean => {
  const category = getFileCategory(fileName);
  return category === 'pdf';
};

export const isBinaryFile = (fileName: string): boolean => {
  const binaryExtensions = new Set([
    'pyc', 'pyo', 'pyd', 'exe', 'dll', 'so', 'dylib',
    'bin', 'dat', 'mp3', 'mp4', 'wav', 'avi', 'mov',
    'mkv', 'flv', 'wmv', 'zip', 'tar', 'gz', 'rar',
    '7z', 'bz2', 'ttf', 'otf', 'woff', 'woff2', 'eot',
    'class', 'jar', 'war', 'ear', 'lock', 'sqlite', 'db'
  ]);
  const ext = getFileExtension(fileName);
  return binaryExtensions.has(ext);
};

export const getFileIcon = (fileName: string): string => {
  const category = getFileCategory(fileName);
  const iconMap: Record<FileCategory, string> = {
    code: 'code',
    markdown: 'markdown',
    office: 'file-word',
    pdf: 'file-pdf',
    image: 'file-image',
    text: 'file-text',
    binary: 'file-unknown',
    unsupported: 'file-unknown',
  };
  return iconMap[category] || 'file';
};

export const getFileColor = (fileName: string): string => {
  const category = getFileCategory(fileName);
  const colorMap: Record<FileCategory, string> = {
    code: '#3b82f6',
    markdown: '#6366f1',
    office: '#2563eb',
    pdf: '#ef4444',
    image: '#ec4899',
    text: '#64748b',
    binary: '#64748b',
    unsupported: '#64748b',
  };
  return colorMap[category] || '#64748b';
};
