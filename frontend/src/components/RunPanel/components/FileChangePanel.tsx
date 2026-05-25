import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Tag, Button, Typography, Tooltip, App } from 'antd';
import {
  FileAddOutlined,
  EditOutlined,
  DeleteOutlined,
  FileOutlined,
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  AppstoreOutlined,
  CodeOutlined,
  PictureOutlined,
  FilePdfOutlined,
  FileZipOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  AudioOutlined,
  VideoCameraOutlined,
  DownOutlined,
  UpOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { fileChangesApi, FileChange } from '../../../services/fileChangesApi';
import type { FileChangeInfo } from '../types';
import { FileOperation, ChangeStatus } from '../constants/fileChangeTypes';
import type { ChangeStatusType } from '../constants/fileChangeTypes';
import { useRunPanelStore } from '../stores/runPanelStore';
import { useRunProjectStore } from '../../../store/runProjectStore';
import '../styles/FileChangeStyles.css';

const { Text } = Typography;

interface FileChangePanelProps {
  sessionId: string;
  messageId: string;
  subsequentMessageIds?: string[];
  refreshKey?: number;
  workingDir?: string;
  initialChanges?: FileChangeInfo[] | null;
  onFileClick?: (filePath: string) => void;
}

interface ChangesSummary {
  total_changes: number;
  total_lines_added: number;
  total_lines_removed: number;
}

const operationConfig: Record<string, { color: string; icon: React.ReactNode; label: string; className: string }> = {
  [FileOperation.CREATED]: { color: '#2e7d32', icon: <FileAddOutlined />, label: '新建', className: 'created' },
  [FileOperation.MODIFIED]: { color: '#1565c0', icon: <EditOutlined />, label: '修改', className: 'modified' },
  [FileOperation.DELETED]: { color: '#c62828', icon: <DeleteOutlined />, label: '删除', className: 'deleted' },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  [ChangeStatus.PENDING]: { color: 'default', label: '待处理' },
  [ChangeStatus.ACCEPTED]: { color: 'success', label: '已接受' },
  [ChangeStatus.REJECTED]: { color: 'error', label: '已拒绝' },
  [ChangeStatus.REVERTED]: { color: 'warning', label: '已撤回' },
};

export const FileChangePanel: React.FC<FileChangePanelProps> = ({
  sessionId,
  messageId,
  subsequentMessageIds = [],
  refreshKey,
  workingDir,
  initialChanges,
  onFileClick,
}) => {
  const { message } = App.useApp();
  const convertInitialChanges = (ics: FileChangeInfo[]): FileChange[] => {
    return ics.map((ic) => ({
      id: ic.id || `preview_${ic.file_path}`,
      session_id: sessionId,
      message_id: messageId,
      file_path: ic.file_path,
      operation: ic.operation,
      content_type: ic.content_type,
      lines_added: ic.diff?.lines_added || 0,
      lines_removed: ic.diff?.lines_removed || 0,
      status: (ic.status as ChangeStatusType) || 'pending' as ChangeStatusType,
      created_at: new Date().toISOString(),
    }));
  };

  const convertedInitial = initialChanges && initialChanges.length > 0 ? convertInitialChanges(initialChanges) : null;

  const [changes, setChanges] = useState<FileChange[]>(convertedInitial || []);
  const [summary, setSummary] = useState<ChangesSummary | null>(() => {
    if (convertedInitial) {
      return {
        total_changes: convertedInitial.length,
        total_lines_added: convertedInitial.reduce((s, c) => s + (c.lines_added || 0), 0),
        total_lines_removed: convertedInitial.reduce((s, c) => s + (c.lines_removed || 0), 0),
      };
    }
    return null;
  });
  const [expanded, setExpanded] = useState(false);

  const isInitializedRef = useRef(false);
  const prevRefreshKeyRef = useRef<number | undefined>(refreshKey);

  const loadChanges = useCallback(async () => {
    if (!sessionId || !messageId) return;

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      prevRefreshKeyRef.current = refreshKey;
      if (initialChanges && initialChanges.length > 0) {
        const converted = convertInitialChanges(initialChanges);
        setChanges(converted);
        setSummary({
          total_changes: converted.length,
          total_lines_added: converted.reduce((s, c) => s + (c.lines_added || 0), 0),
          total_lines_removed: converted.reduce((s, c) => s + (c.lines_removed || 0), 0),
        });
        return;
      }
      return;
    }

    prevRefreshKeyRef.current = refreshKey;

    if (!refreshKey) return;

    try {
      const response = await fileChangesApi.getSessionFileChanges(sessionId, {
        message_ids: [messageId],
        diff_type: 'net',
      });
      const data = (response as any)?.data || response;
      if (data && data.changes && data.changes.length > 0) {
        setChanges(data.changes);
        setSummary(data.summary || null);
      }
    } catch (error) {
      console.error('[FileChangePanel] Failed to load file changes:', error);
    }
  }, [sessionId, messageId, refreshKey]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges]);

  const handleAccept = async (changeId: string) => {
    setChanges(prev => prev.map(c =>
      c.id === changeId ? { ...c, _loading: true } : c
    ));
    try {
      await fileChangesApi.updateChangeStatus({ change_id: changeId, status: 'accepted' });
      setChanges(prev => prev.map(c =>
        c.id === changeId ? { ...c, status: 'accepted' as ChangeStatusType, _loading: false } : c
      ));
    } catch (error: any) {
      setChanges(prev => prev.map(c =>
        c.id === changeId ? { ...c, _loading: false } : c
      ));
      message.error(`接受变更失败: ${error?.message || '未知错误'}`);
    }
  };

  const handleReject = async (change: FileChange) => {
    setChanges(prev => prev.map(c =>
      c.file_path === change.file_path ? { ...c, _loading: true } : c
    ));
    try {
      const response: any = await fileChangesApi.revertFileChanges({
        session_id: sessionId,
        message_id: messageId,
        file_paths: [change.file_path],
      });
      const data = response?.data || response;
      if (data?.failed_files && data.failed_files.length > 0) {
        message.warning(`部分文件撤回失败: ${data.failed_files.join(', ')}`);
      }
      setChanges(prev => prev.map(c =>
        c.file_path === change.file_path ? { ...c, status: 'reverted' as ChangeStatusType, _loading: false } : c
      ));
      useRunProjectStore.getState().listFiles('');
    } catch (error: any) {
      setChanges(prev => prev.map(c =>
        c.file_path === change.file_path ? { ...c, _loading: false } : c
      ));
      message.error(`撤回变更失败: ${error?.message || '未知错误'}`);
    }
  };

  const getFileIcon = (filePath: string) => {
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

  if (!changes || changes.length === 0) {
    return null;
  }

  const addedTotal = summary?.total_lines_added || 0;
  const removedTotal = summary?.total_lines_removed || 0;
  const fileCount = summary?.total_changes || changes.length;

  return (
    <div className="sc-change-bar">
      <div className="sc-change-bar-icon">
        <AppstoreOutlined />
      </div>
      <span className="sc-change-bar-text">
        {fileCount} 个文件已更改
      </span>
      <span className="sc-change-bar-added">+{addedTotal}</span>
      <span className="sc-change-bar-removed">-{removedTotal}</span>
      <Button
        className="sc-change-bar-btn"
        size="small"
        icon={<EyeOutlined />}
        onClick={() => {
          const store = useRunPanelStore.getState();
          store.incrementFileChangeRefreshKey();
          store.setActiveChangesMessageId(messageId);
          store.openAgenticPanel('changes');
        }}
      >
        查看变更
      </Button>
      <Button
        className="sc-change-bar-toggle"
        type="text"
        size="small"
        icon={expanded ? <UpOutlined /> : <DownOutlined />}
        onClick={() => setExpanded(!expanded)}
      />

      {expanded && (
        <div className="sc-change-file-list">
          {changes.map((change, index) => {
            const config = operationConfig[change.operation] || operationConfig.modified;
            const status = statusConfig[change.status] || statusConfig.pending;
            const isAccepted = change.status === 'accepted';
            const isReverted = change.status === 'reverted';
            const isFinalized = isAccepted || isReverted;
            const isPending = ['pending', 'rejected'].includes(change.status);
            const isLoading = (change as any)._loading === true;
            const fileName = change.file_path.split(/[\\/]/).pop() || change.file_path;
            const absolutePath = workingDir
              ? `${workingDir.replace(/\\/g, '/')}/${change.file_path.replace(/\\/g, '/')}`
              : change.file_path.replace(/\\/g, '/');

            return (
              <div
                key={change.id || index}
                className={`sc-change-file-item ${isReverted ? 'reverted' : ''} ${isAccepted ? 'accepted' : ''} ${isFinalized ? 'finalized' : ''}`}
              >
                <span className="sc-change-file-icon">{getFileIcon(change.file_path)}</span>
                <span
                  className="sc-change-file-name"
                  onClick={() => onFileClick?.(change.file_path)}
                  title={`点击打开: ${change.file_path}`}
                >{fileName}</span>
                <span className="sc-change-file-dir">{absolutePath}</span>
                <Tag className={`sc-change-op-badge ${config.className}`}>{config.label}</Tag>
                {change.content_type !== 'binary' && (
                  <span className="sc-change-file-stats">
                    <span className="added">+{change.lines_added || 0}</span>
                    <span className="removed">-{change.lines_removed || 0}</span>
                  </span>
                )}
                <div className="sc-change-file-actions">
                  {isLoading ? (
                    <LoadingOutlined className="sc-change-loading-icon" />
                  ) : isPending ? (
                    <>
                      <Tooltip title="接受">
                        <Button type="text" size="small" icon={<CheckOutlined />} onClick={() => handleAccept(change.id)} className="sc-change-action-btn accept" />
                      </Tooltip>
                      <Tooltip title="拒绝">
                        <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => handleReject(change)} className="sc-change-action-btn reject" />
                      </Tooltip>
                    </>
                  ) : (
                    <Tag className={`sc-change-status-tag ${isAccepted ? 'status-accepted' : 'status-reverted'}`}>
                      {isAccepted ? <CheckOutlined style={{ marginRight: 2 }} /> : <CloseOutlined style={{ marginRight: 2 }} />}
                      {status.label}
                    </Tag>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};

export default FileChangePanel;
