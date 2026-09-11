/**
 * @file fileIcon.tsx
 * @description F6：文件图标唯一实现
 * - getFileIcon：消息区/文件变更区共用（按扩展名映射，原 MessageList/FileChangePanel 各自内联的相同实现）
 * - getExplorerFileIcon：文件树用（目录感知，原 FileExplorer 内联实现）
 */
import {
  AudioOutlined,
  CodeOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FileOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';

// 消息区/文件变更区：按扩展名映射文件图标（MessageList/FileChangePanel 共用同一实现）
export const getFileIcon = (filePath: string) => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, React.ReactNode> = {
    js: <CodeOutlined style={{ color: '#f7df1e' }} />,
    jsx: <CodeOutlined style={{ color: '#61dafb' }} />,
    ts: <CodeOutlined style={{ color: '#3178c6' }} />,
    tsx: <CodeOutlined style={{ color: '#61dafb' }} />,
    py: <CodeOutlined style={{ color: '#3776ab' }} />,
    java: <CodeOutlined style={{ color: '#ed8b00' }} />,
    go: <CodeOutlined style={{ color: '#00add8' }} />,
    rs: <CodeOutlined style={{ color: '#dea584' }} />,
    c: <CodeOutlined style={{ color: '#555555' }} />,
    cpp: <CodeOutlined style={{ color: '#00599c' }} />,
    html: <CodeOutlined style={{ color: '#e34c26' }} />,
    css: <CodeOutlined style={{ color: '#264de4' }} />,
    scss: <CodeOutlined style={{ color: '#c6538c' }} />,
    json: <CodeOutlined style={{ color: '#5b5b5b' }} />,
    yaml: <CodeOutlined style={{ color: '#cb171e' }} />,
    yml: <CodeOutlined style={{ color: '#cb171e' }} />,
    md: <FileTextOutlined style={{ color: '#4a4a4a' }} />,
    svg: <PictureOutlined style={{ color: '#ffb13b' }} />,
    png: <PictureOutlined style={{ color: '#ff6b6b' }} />,
    jpg: <PictureOutlined style={{ color: '#ff6b6b' }} />,
    jpeg: <PictureOutlined style={{ color: '#ff6b6b' }} />,
    gif: <PictureOutlined style={{ color: '#ff6b6b' }} />,
    pdf: <FilePdfOutlined style={{ color: '#f40f02' }} />,
    zip: <FileZipOutlined style={{ color: '#ffa726' }} />,
    tar: <FileZipOutlined style={{ color: '#ffa726' }} />,
    gz: <FileZipOutlined style={{ color: '#ffa726' }} />,
    xlsx: <FileExcelOutlined style={{ color: '#217346' }} />,
    xls: <FileExcelOutlined style={{ color: '#217346' }} />,
    pptx: <FilePptOutlined style={{ color: '#d24726' }} />,
    mp3: <AudioOutlined style={{ color: '#9b59b6' }} />,
    wav: <AudioOutlined style={{ color: '#9b59b6' }} />,
    mp4: <VideoCameraOutlined style={{ color: '#e74c3c' }} />,
  };
  return iconMap[ext] || <FileOutlined style={{ color: 'var(--text-200)' }} />;
};

// 文件树：目录感知版本（FileExplorer 用）
export const getExplorerFileIcon = (name: string, isDir: boolean, isOpen?: boolean) => {
  if (isDir) {
    return isOpen
      ? <FolderOpenOutlined style={{ color: '#f59e0b' }} />
      : <FolderOutlined style={{ color: '#f59e0b' }} />;
  }

  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return <CodeOutlined style={{ color: '#3b82f6' }} />;
    case 'py':
      return <CodeOutlined style={{ color: '#22c55e' }} />;
    case 'json':
      return <CodeOutlined style={{ color: '#f59e0b' }} />;
    case 'md':
    case 'markdown':
      return <FileMarkdownOutlined style={{ color: '#6366f1' }} />;
    case 'txt':
    case 'log':
      return <FileTextOutlined style={{ color: '#64748b' }} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <FileImageOutlined style={{ color: '#ec4899' }} />;
    case 'zip':
    case 'tar':
    case 'gz':
      return <FileZipOutlined style={{ color: '#8b5cf6' }} />;
    case 'pdf':
      return <FilePdfOutlined style={{ color: '#ef4444' }} />;
    default:
      return <FileOutlined style={{ color: '#94a3b8' }} />;
  }
};
