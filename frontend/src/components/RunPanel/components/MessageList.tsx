import React, { useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle, useState } from 'react';
import { Typography, Tooltip, App } from 'antd';
import { RobotOutlined, UndoOutlined, DeleteOutlined, FileAddOutlined, CloseCircleOutlined, CloseOutlined, FileTextOutlined, ExclamationCircleOutlined, CodeOutlined, PictureOutlined, FilePdfOutlined, FileZipOutlined, FileExcelOutlined, FilePptOutlined, AudioOutlined, VideoCameraOutlined, FileOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useRunPanelStore } from '../stores/runPanelStore';
import type { LLMMessage, DataBlock, FileChangeInfo } from '../types';
import BeautifulMarkdownRenderer from '../../common/BeautifulMarkdownRenderer';
import FileChangePanel from './FileChangePanel';
import AutoScrollContainer from './AutoScrollContainer';
import { formatSmartTime } from '../../../utils/timezone';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { fileChangesApi } from '../../../services/fileChangesApi';
import ConfirmDialog from '../../common/ConfirmDialog';
import '../styles/FileChangeStyles.css';

const { Text } = Typography;

const SUBAGENT_BASE_COLOR = '#3F51B5';
const FILE_OP_TOOLS = new Set(['Write', 'SearchReplace', 'DeleteFile', 'write_file', 'search_replace', 'delete_file', 'create_file', 'edit_file']);

const getSubagentColor = (depth: number): string => {
  if (depth === 0) return 'transparent';
  const level = ((depth - 1) % 4) + 1;
  const opacityMap: Record<number, number> = { 1: 0.4, 2: 0.6, 3: 0.8, 4: 1.0 };
  const opacity = opacityMap[level];
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${SUBAGENT_BASE_COLOR}${alpha}`;
};

interface AgentGroup {
  agent_id: string;
  agent_name: string;
  agent_level: number;
  blocks: DataBlock[];
}

const groupDataBlocksByAgent = (blocks: DataBlock[]): AgentGroup[] => {
  const groups: AgentGroup[] = [];
  let currentGroup: AgentGroup | null = null;
  for (const block of blocks) {
    const agentId = block.agent_id || 'default';
    const agentName = block.agent_name || 'AI助手';
    const agentLevel = block.agent_level || 0;
    if (!currentGroup || currentGroup.agent_id !== agentId) {
      currentGroup = { agent_id: agentId, agent_name: agentName, agent_level: agentLevel, blocks: [] };
      groups.push(currentGroup);
    }
    currentGroup.blocks.push(block);
  }
  return groups;
};

const ThoughtBlock = React.memo(({ block, isExpanded, onToggle, blockKey }: {
  block: DataBlock;
  isExpanded: boolean;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKey: string;
}) => {
  return (
    <div style={{ width: '100%' }}>
      <div onClick={() => onToggle(block, blockKey, isExpanded)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: 12, color: 'var(--text-200)', width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>ⓘ</span>
        <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>Thought</Text>
      </div>
      {isExpanded && (
        <AutoScrollContainer maxHeight="50vh" dependency={block.reasoning_content} style={{ transition: 'max-height 0.5s ease-in-out' }}>
          <div style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: 2, background: 'var(--bg-300)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, padding: '0 0 6px 6px', fontSize: 12, color: 'var(--text-200)', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
            {block.reasoning_content}
          </div>
        </AutoScrollContainer>
      )}
    </div>
  );
}, (prev, next) => prev.block === next.block && prev.isExpanded === next.isExpanded);

const ToolCallsBlock = React.memo(({ block, msgId, onToggle, blockKey, fileChangesMap, allBlocks, onFileClick }: {
  block: DataBlock;
  msgId: string;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKey: string;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  allBlocks?: DataBlock[];
  onFileClick?: (filePath: string) => void;
}) => {
  const expandedBlockKeys = useRunPanelStore(state => state.expandedBlockKeys);

  const streamingFileChanges = useMemo(() => {
    return (allBlocks?.filter(b => b.type === 'file_changes') || []).flatMap(b => b.file_changes || []);
  }, [allBlocks]);

  const streamingPreviewChanges = useMemo(() => {
    return streamingFileChanges.filter((fc: any) => fc._preview);
  }, [streamingFileChanges]);

  const apiFileChanges: FileChangeInfo[] = fileChangesMap[msgId] || [];

  return (
    <>
      {block.tool_calls?.map((tc, tcIdx) => {
        const toolName = tc.function?.name || '';
        const isFileOpTool = FILE_OP_TOOLS.has(toolName);
        const toolArgs = (() => {
          try { return typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments; }
          catch { return null; }
        })();
        const toolFilePath = toolArgs?.path || toolArgs?.file_path || toolArgs?.filename;
        const toolKey = `${blockKey}-tc-${tcIdx}`;
        const toolExpanded = expandedBlockKeys[toolKey] ?? block._isExpanding ?? false;
        const matchedChanges = isFileOpTool ? (() => {
          const previewMatches = streamingPreviewChanges.filter((fc: any) => tc.id && fc.tool_call_id && fc.tool_call_id === tc.id);
          if (previewMatches.length > 0) return previewMatches;
          const apiMatches = apiFileChanges.filter((fc: any) => tc.id && fc.tool_call_id && fc.tool_call_id === tc.id);
          if (apiMatches.length > 0) return apiMatches;
          return apiFileChanges.filter((fc: any) => {
            if (!toolFilePath) return false;
            const fcPath = fc.file_path?.replace(/\\/g, '/');
            const toolPath = toolFilePath?.replace(/\\/g, '/');
            return fcPath === toolPath || fcPath?.endsWith(toolPath) || toolPath?.endsWith(fcPath);
          });
        })() : [];

        return (
          <div key={tcIdx} style={{ width: '100%' }}>
            <div onClick={() => onToggle(block, toolKey, toolExpanded)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: 12, color: 'var(--text-200)', width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>⚙︎</span>
              <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>{tc.function?.name}</Text>
              {matchedChanges.length > 0 && matchedChanges.map((fc: any, i: number) => {
                const fileName = fc.file_path?.split(/[\\/]/).pop() || '';
                if (fc.operation === 'deleted') {
                  return (<React.Fragment key={i}><span style={{ flex: 1 }} /><span className="sc-tool-fc-name" onClick={(e) => { e.stopPropagation(); onFileClick?.(fc.file_path); }} title={`点击打开: ${fc.file_path}`}>{fileName}</span><DeleteOutlined style={{ fontSize: 11, color: '#ff4d4f', marginLeft: 6 }} /></React.Fragment>);
                }
                const added = fc.diff?.lines_added ?? 0;
                const removed = fc.diff?.lines_removed ?? 0;
                return (<React.Fragment key={i}><span style={{ flex: 1 }} /><span className="sc-tool-fc-name" onClick={(e) => { e.stopPropagation(); onFileClick?.(fc.file_path); }} title={`点击打开: ${fc.file_path}`}>{fileName}</span><FileAddOutlined style={{ fontSize: 11, color: '#52c41a', marginLeft: 6 }} /><Text style={{ fontSize: 11, marginLeft: 4 }}><span style={{ color: '#52c41a' }}>+{added}</span><span style={{ color: '#ff4d4f', marginLeft: 4 }}>-{removed}</span></Text></React.Fragment>);
              })}
            </div>
            {toolExpanded && (
              <AutoScrollContainer maxHeight="50vh" dependency={`${tc.function?.arguments}${tc.result}`} style={{ transition: 'max-height 0.5s ease-in-out' }}>
                <div style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ width: 2, background: 'var(--bg-300)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0, padding: '0 0 6px 6px', fontSize: 12, color: 'var(--text-200)', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                  参数: {tc.function?.arguments}
                  {tc.result && (
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontWeight: 500 }}>结果:</span>
                      {(() => {
                        try {
                          const parsed = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
                          if (parsed && typeof parsed === 'object') {
                            return (<div style={{ marginTop: 4 }}>{Object.entries(parsed).map(([key, value]) => (<div key={key} style={{ marginTop: 2 }}><span style={{ fontWeight: 500, color: 'var(--text-200)' }}>{key}:</span>{' '}<span style={{ color: 'var(--text-100)' }}>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</span></div>))}</div>);
                          }
                        } catch { return ` ${tc.result}`; }
                        return ` ${tc.result}`;
                      })()}
                    </div>
                  )}
                  </div>
              </AutoScrollContainer>
            )}
          </div>
        );
      })}
    </>
  );
}, (prev, next) => prev.block === next.block && prev.fileChangesMap === next.fileChangesMap && prev.allBlocks === next.allBlocks);

const ContentBlock = React.memo(({ content }: { content: string }) => {
  return <BeautifulMarkdownRenderer>{content || ''}</BeautifulMarkdownRenderer>;
}, (prev, next) => prev.content === next.content);

const DataBlockItem = React.memo(({ block, idx, msgId, onToggle, blockKey, fileChangesMap, allBlocks, onFileClick }: {
  block: DataBlock;
  idx: number;
  msgId: string;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKey: string;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  allBlocks?: DataBlock[];
  onFileClick?: (filePath: string) => void;
}) => {
  const isExpanded = useRunPanelStore(state => state.expandedBlockKeys[blockKey] ?? block._isExpanding ?? false);

  if (block.type === 'reasoning_content') {
    return <ThoughtBlock block={block} isExpanded={isExpanded} onToggle={onToggle} blockKey={blockKey} />;
  }
  if (block.type === 'tool_calls') {
    return <ToolCallsBlock block={block} msgId={msgId} onToggle={onToggle} blockKey={blockKey} fileChangesMap={fileChangesMap} allBlocks={allBlocks} onFileClick={onFileClick} />;
  }
  if (block.type === 'content') {
    return <ContentBlock content={block.content || ''} />;
  }
  return null;
}, (prev, next) => {
  return prev.block === next.block && prev.blockKey === next.blockKey && prev.fileChangesMap === next.fileChangesMap && prev.allBlocks === next.allBlocks;
});

const AgentGroupItem = React.memo(({ group, msgId, isStreaming, allMessageBlocks, handleBlockToggle, fileChangesMap, onFileClick }: {
  group: AgentGroup;
  msgId: string;
  isStreaming: boolean;
  allMessageBlocks: DataBlock[];
  handleBlockToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  onFileClick?: (filePath: string) => void;
}) => {
  const isMainAgent = group.agent_level === 0;
  const borderColor = getSubagentColor(group.agent_level);

  const blocks = group.blocks.map((block, idx) => {
    const blockKey = `${msgId}-${idx}`;
    return (
      <DataBlockItem
        key={idx}
        block={block}
        idx={idx}
        msgId={msgId}
        onToggle={handleBlockToggle}
        blockKey={blockKey}
        fileChangesMap={fileChangesMap}
        allBlocks={allMessageBlocks || group.blocks}
        onFileClick={onFileClick}
      />
    );
  });

  if (isMainAgent) {
    return <>{blocks}</>;
  }

  return (
    <div style={{
      marginLeft: 14 * group.agent_level,
      marginTop: 8,
      borderLeft: `3px solid ${borderColor}`,
      paddingLeft: 12,
      background: 'rgba(63, 81, 181, 0.05)',
      borderRadius: 6,
      paddingBottom: 8,
    }}>
      <div style={{ marginBottom: 4 }}>
        <Text style={{ fontSize: 13, color: borderColor, fontWeight: 500 }}>
          {group.agent_name}
        </Text>
      </div>
      {blocks}
    </div>
  );
}, (prev, next) => {
  return prev.group === next.group
    && prev.fileChangesMap === next.fileChangesMap
    && prev.allMessageBlocks === next.allMessageBlocks;
});

const extractAgentName = (msg: LLMMessage): string | null => {
  if (msg.agent_name) return msg.agent_name;
  for (const block of msg.data || []) {
    if (block.type === 'tool_calls') {
      for (const tc of block.tool_calls || []) {
        if (tc.function?.name === 'Task' && tc.result) {
          try {
            const result = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
            if (result.subagent_name) return result.subagent_name;
          } catch {}
        }
      }
    }
  }
  return null;
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

const UserMessageItem = React.memo(({ msg, isHovered, onHover, onLeave, onRewind, onCancelPreview, onConfirmRecall, onFileClick, currentSessionId, onDelete }: {
  msg: LLMMessage;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onRewind: () => void;
  onCancelPreview: () => void;
  onConfirmRecall: () => void;
  onFileClick?: (filePath: string) => void;
  currentSessionId: string | null;
  onDelete: (deletedIds: string[]) => void;
}) => {
  const { message: antMessage } = App.useApp();
  const recallingMessageId = useRunPanelStore(state => state.recallingMessageId);
  const recallPreviewFiles = useRunPanelStore(state => state.recallPreviewFiles);
  const recallPreviewMessageId = useRunPanelStore(state => state.recallPreviewMessageId);
  const previewFiles = recallPreviewFiles[msg.id];
  const isPreviewing = recallPreviewMessageId === msg.id;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      antMessage.success('已复制到剪贴板');
    }).catch(() => {
      antMessage.error('复制失败');
    });
  }, [msg.content, antMessage]);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeleteClick = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    try {
      const result = await fileChangesApi.deleteMessages({
        session_id: currentSessionId!,
        from_message_id: msg.id,
      });
      const data = (result as any)?.data || result;
      const deletedIds = data?.deleted_ids || [];
      onDelete(deletedIds);
      antMessage.success('消息已删除');
    } catch (err: any) {
      const status = err?.response?.status;
      const serverDetail = err?.response?.data?.detail || '';
      const errorMsg = serverDetail
        ? `删除失败: ${serverDetail} (HTTP ${status})`
        : `删除失败: ${err?.message || '未知错误'} (HTTP ${status || '?'})`;
      antMessage.error(errorMsg);
    }
  }, [antMessage, currentSessionId, msg.id, onDelete]);

  const isRecallDisabled = !!recallingMessageId || isPreviewing;

  const actionBtnStyle = useMemo((): React.CSSProperties => ({
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'var(--text-300)',
    transition: 'all 0.15s',
    border: 'none',
    background: 'transparent',
  }), []);

  return (
    <div data-message-role="user" onMouseEnter={onHover} onMouseLeave={onLeave} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row-reverse', height: 28 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontWeight: 500, fontSize: 12, lineHeight: '28px' }}>U</span>
        </div>
        <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500, lineHeight: '28px' }}>用户</Text>
        <Text style={{ fontSize: 12, color: 'var(--text-300)', opacity: isHovered ? 1 : 0, transition: 'opacity 0.2s', lineHeight: '28px' }}>
          {formatSmartTime(msg.timestamp)}
        </Text>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexDirection: 'row', maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, opacity: isHovered ? 1 : 0, transition: 'opacity 0.2s', flexShrink: 0, marginTop: 6 }}>
          <Tooltip title="复制">
            <button
              style={actionBtnStyle}
              onClick={(e) => { e.stopPropagation(); handleCopy(); }}
              className="sc-message-action-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </Tooltip>
          <Tooltip title="删除">
            <button
              style={actionBtnStyle}
              onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
              className="sc-message-action-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </Tooltip>
          <Tooltip title="撤回此次对话">
            <button
              style={{ ...actionBtnStyle, cursor: isRecallDisabled ? 'not-allowed' : 'pointer', opacity: isRecallDisabled ? 0.4 : 1 }}
              disabled={isRecallDisabled}
              onClick={(e) => { e.stopPropagation(); if (!isRecallDisabled) onRewind(); }}
              className="sc-message-action-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <path d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 0 1 0 12h-3"/>
              </svg>
            </button>
          </Tooltip>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-200)', maxWidth: '90%', minWidth: 0 }}>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', lineHeight: 1.7, fontSize: 14, color: 'var(--text-100)' }}>
            {msg.content}
          </div>
        </div>
      </div>
      {isPreviewing && (
        <div className="sc-recall-preview-panel">
          <div className="sc-recall-preview-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ExclamationCircleOutlined style={{ fontSize: 14, color: '#faad14' }} />
              <span className="sc-recall-preview-title">确定要回退至此次问答重新发起吗？</span>
            </div>
            <CloseOutlined className="sc-recall-preview-close" onClick={onCancelPreview} />
          </div>
          {previewFiles && previewFiles.length > 0 ? (
            <div className="sc-change-file-list">
              {previewFiles.map((f: any) => {
                const fileName = f.file_path.split(/[\\/]/).pop() || f.file_path;
                const absPath = f.absolute_path || f.file_path;
                const actionMap: Record<string, { label: string; className: string }> = {
                  '删除': { label: '将被删除', className: 'deleted' },
                  '新建': { label: '将被新建', className: 'created' },
                  '修改': { label: '将被修改', className: 'modified' },
                };
                const action = actionMap[f.recall_action] || { label: f.recall_action, className: 'modified' };
                return (
                  <div key={f.file_path} className="sc-change-file-item">
                    <span className="sc-change-file-icon">{getFileIcon(f.file_path)}</span>
                    <span
                      className="sc-change-file-name"
                      onClick={() => onFileClick?.(f.absolute_path || f.file_path)}
                      title={`点击打开: ${f.absolute_path || f.file_path}`}
                    >{fileName}</span>
                    <span className="sc-change-file-dir">{absPath}</span>
                    <span className="sc-change-file-stats-right">
                      <span className={`sc-change-op-badge ${action.className}`}>{action.label}</span>
                      <span className="sc-change-file-stats">
                        <span className="added">+{f.lines_removed || 0}</span>
                        <span className="removed">-{f.lines_added || 0}</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sc-recall-preview-info-row">
              <InfoCircleOutlined style={{ fontSize: 14, color: 'var(--primary-100)' }} />
              <span>仅撤回对话消息，无文件变更</span>
            </div>
          )}
          <div className="sc-recall-preview-actions">
            <button className="sc-recall-cancel-btn" onClick={onCancelPreview}>取消</button>
            <button className="sc-recall-confirm-btn" disabled={!!recallingMessageId} onClick={onConfirmRecall}>
              {recallingMessageId && <LoadingOutlined spin />}
              <span>确认</span>
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="删除此消息"
        content="确定要删除此消息及其后续回复吗？此操作不可恢复，但不会影响已创建的文件。"
        okText="确认"
        cancelText="取消"
        danger
        onOk={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
}, (prev, next) => prev.msg === next.msg && prev.isHovered === next.isHovered);

const AssistantMessageItem = React.memo(({ msg, msgIdx, messages, currentSessionId, currentProject, fileChangeRefreshKey, fileChangesMap, handleBlockToggle, onFileClick }: {
  msg: LLMMessage;
  msgIdx: number;
  messages: LLMMessage[];
  currentSessionId: string | null;
  currentProject: any;
  fileChangeRefreshKey: number;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  handleBlockToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  onFileClick?: (filePath: string) => void;
}) => {
  const agentGroups = useMemo(() => {
    return msg.data ? groupDataBlocksByAgent(msg.data) : [];
  }, [msg.data]);

  const getFileChangesForMessage = (msgId: string, blocks: DataBlock[] | undefined) => {
    const apiChanges = fileChangesMap[msgId]?.filter((fc: any) => !fc.tool_call_id);
    if (apiChanges && apiChanges.length > 0) return apiChanges;
    if (!blocks) return null;
    return blocks.filter(b => b.type === 'file_changes' && !b.file_changes?.some((fc: any) => fc._preview)).flatMap(b => b.file_changes || []);
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>
            {extractAgentName(msg) || 'AI助手'}
          </Text>
          <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>
            {formatSmartTime(msg.timestamp)}
          </Text>
          {msg.tokens != null && msg.tokens > 0 && (
            <Text style={{ fontSize: 11, color: 'var(--text-400)', background: 'var(--bg-200)', padding: '0 6px', borderRadius: 4 }}>
              {msg.tokens >= 1000 ? `${(msg.tokens / 1000).toFixed(1)}k` : msg.tokens} tokens
            </Text>
          )}
        </div>
        {msg.data && agentGroups.map((group, groupIdx) => (
          <AgentGroupItem
            key={groupIdx}
            group={group}
            msgId={msg.id}
            isStreaming={false}
            allMessageBlocks={msg.data!}
            handleBlockToggle={handleBlockToggle}
            fileChangesMap={fileChangesMap}
            onFileClick={onFileClick}
          />
        ))}
        {msg.status === 'error' && msg.error && (
          <div style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'rgba(255, 77, 79, 0.08)',
            borderLeft: '3px solid #ff4d4f',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}>
            <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 14, marginTop: 2, flexShrink: 0 }} />
            <Text style={{ fontSize: 13, color: '#ff4d4f', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', lineHeight: 1.6 }}>
              {msg.error}
            </Text>
          </div>
        )}
        {currentSessionId && (msg.status === 'completed' || msg.status === 'error' || msg.status === 'stopped') && (
          <FileChangePanel
            sessionId={currentSessionId}
            messageId={msg.id}
            subsequentMessageIds={messages.filter((m, i) => i > msgIdx && m.role === 'assistant').map(m => m.id)}
            refreshKey={fileChangeRefreshKey}
            workingDir={currentProject?.folder_path}
            initialChanges={getFileChangesForMessage(msg.id, msg.data)}
            onFileClick={onFileClick}
          />
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.msg === next.msg
    && prev.msgIdx === next.msgIdx
    && prev.messages === next.messages
    && prev.currentSessionId === next.currentSessionId
    && prev.currentProject === next.currentProject
    && prev.fileChangeRefreshKey === next.fileChangeRefreshKey
    && prev.fileChangesMap === next.fileChangesMap
    && prev.handleBlockToggle === next.handleBlockToggle;
});

export interface MessageListHandle {
  isAutoScrollEnabled: boolean;
  scrollToBottom: () => void;
  disableAutoScroll: () => void;
}

interface MessageListProps {
  isWaitingReply: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  onFileClick?: (filePath: string) => void;
}

const MessageList = forwardRef<MessageListHandle, MessageListProps>(({ isWaitingReply, scrollContainerRef, onFileClick }, ref) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useRunPanelStore(state => state.messages);
  const streamingData = useRunPanelStore(state => state.streamingData);
  const toggleBlockExpand = useRunPanelStore(state => state.toggleBlockExpand);
  const hoveredMessageId = useRunPanelStore(state => state.hoveredMessageId);
  const setHoveredMessageId = useRunPanelStore(state => state.setHoveredMessageId);
  const currentSessionId = useRunPanelStore(state => state.currentSessionId);
  const currentProject = useRunPanelStore(state => state.currentProject);
  const recallingMessageId = useRunPanelStore(state => state.recallingMessageId);
  const setMessages = useRunPanelStore(state => state.setMessages);
  const setRecallingMessageId = useRunPanelStore(state => state.setRecallingMessageId);
  const setRecallPreviewFiles = useRunPanelStore(state => state.setRecallPreviewFiles);
  const clearRecallPreview = useRunPanelStore(state => state.clearRecallPreview);
  const recallPreviewMessageId = useRunPanelStore(state => state.recallPreviewMessageId);
  const setInputText = useRunPanelStore(state => state.setInputText);
  const fileChangeRefreshKey = useRunPanelStore(state => state.fileChangeRefreshKey);
  const incrementFileChangeRefreshKey = useRunPanelStore(state => state.incrementFileChangeRefreshKey);
  const fileChangesMap = useRunPanelStore(state => state.fileChangesMap);

  const { message: antMessage } = App.useApp();

  const { isAutoScrollEnabled, scrollToBottom, disableAutoScroll, resetAutoScroll, performAutoScroll, performAutoScrollIntoView } = useAutoScroll({
    containerRef: scrollContainerRef,
    bottomThreshold: 64,
  });

  useImperativeHandle(ref, () => ({
    isAutoScrollEnabled,
    scrollToBottom,
    disableAutoScroll,
  }), [isAutoScrollEnabled, scrollToBottom, disableAutoScroll]);

  useEffect(() => {
    resetAutoScroll();
  }, [currentSessionId, resetAutoScroll]);

  const handleBlockToggle = useCallback((block: DataBlock, blockKey: string, currentIsExpanding: boolean) => {
    block._userToggled = true;
    toggleBlockExpand(blockKey, currentIsExpanding);
  }, [toggleBlockExpand]);

  const scrollRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      performAutoScroll();
      scrollRafRef.current = null;
    });
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, [streamingData, performAutoScroll]);

  useEffect(() => {
    performAutoScrollIntoView(messagesEndRef.current);
  }, [messages, performAutoScrollIntoView]);

  const streamingGroups = useMemo(() => {
    return groupDataBlocksByAgent(streamingData);
  }, [streamingData]);

  const messageIds = useMemo(() => messages.map(m => m.id), [messages]);

  const handlePreviewRecall = useCallback(async (msg: LLMMessage) => {
    if (!currentSessionId || recallingMessageId || recallPreviewMessageId) return;

    try {
      const result = await fileChangesApi.previewRewind({
        session_id: currentSessionId,
        from_message_id: msg.id,
      });
      const data = (result as any)?.data || result;
      const files = data?.files || [];

      setRecallPreviewFiles(msg.id, files);
    } catch (err: any) {
      clearRecallPreview();
      const status = err?.response?.status;
      const serverDetail = err?.response?.data?.detail || '';
      console.error('[Recall Preview] Error:', { status, serverDetail, sessionId: currentSessionId, fromMessageId: msg.id });
      const errorMsg = serverDetail
        ? `撤回预览失败: ${serverDetail} (HTTP ${status})`
        : `撤回预览失败: ${err?.message || '未知错误'} (HTTP ${status || '?'})`;
      antMessage.error(errorMsg);
    }
  }, [currentSessionId, recallingMessageId, recallPreviewMessageId, setRecallPreviewFiles, clearRecallPreview, antMessage]);

  const handleConfirmRecall = useCallback(async (msg: LLMMessage) => {
    if (!currentSessionId || recallingMessageId) return;

    setRecallingMessageId(msg.id);
    try {
      const result = await fileChangesApi.rewindMessages({
        session_id: currentSessionId,
        from_message_id: msg.id,
      });
      const data = (result as any)?.data || result;

      const targetIndex = messages.findIndex(m => m.id === msg.id);
      const recalledIds = messages.slice(targetIndex).map(m => m.id);
      setMessages(prev => prev.filter(m => !recalledIds.includes(m.id)));

      setInputText(msg.content || '');

      incrementFileChangeRefreshKey();
      clearRecallPreview();
      antMessage.success('撤回成功');
    } catch (err: any) {
      clearRecallPreview();
      const status = err?.response?.status;
      const serverDetail = err?.response?.data?.detail || '';
      console.error('[Recall] Error details:', { status, serverDetail, sessionId: currentSessionId, fromMessageId: msg.id, rawError: err });
      const errorMsg = serverDetail
        ? `撤回失败: ${serverDetail} (HTTP ${status})`
        : `撤回失败: ${err?.message || '未知错误'} (HTTP ${status || '?'})`;
      antMessage.error(errorMsg);
    } finally {
      setRecallingMessageId(null);
    }
  }, [currentSessionId, recallingMessageId, setRecallingMessageId, messages, setMessages, setInputText, incrementFileChangeRefreshKey, clearRecallPreview, antMessage]);

  const handleCancelRecall = useCallback(() => {
    clearRecallPreview();
  }, [clearRecallPreview]);

  return (
    <>
      {messages.length === 0 && streamingData.length === 0 && !isWaitingReply ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '40px 16px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, boxShadow: '0 8px 24px rgba(63, 81, 181, 0.25)' }}>
            <RobotOutlined style={{ fontSize: 24, color: '#fff' }} />
          </div>
          <Text style={{ fontSize: 16, color: 'var(--text-100)', fontWeight: 600, marginBottom: 8 }}>开始新对话</Text>
          <Text style={{ fontSize: 13, color: 'var(--text-300)', textAlign: 'center', lineHeight: 1.6 }}>在下方输入您的问题</Text>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {messages.map((msg, msgIdx) => {
            if (msg.role === 'user') {
              return (
                <UserMessageItem
                  key={msg.id}
                  msg={msg}
                  isHovered={hoveredMessageId === msg.id}
                  onHover={() => setHoveredMessageId(msg.id)}
                  onLeave={() => setHoveredMessageId(null)}
                  onRewind={() => {
                    handlePreviewRecall(msg);
                  }}
                  onCancelPreview={handleCancelRecall}
                  onConfirmRecall={() => {
                    handleConfirmRecall(msg);
                  }}
                  onFileClick={onFileClick}
                  currentSessionId={currentSessionId}
                  onDelete={(deletedIds) => {
                    setMessages(prev => prev.filter(m => !deletedIds.includes(m.id)));
                  }}
                />
              );
            }
            return (
              <AssistantMessageItem
                key={msg.id}
                msg={msg}
                msgIdx={msgIdx}
                messages={messages}
                currentSessionId={currentSessionId}
                currentProject={currentProject}
                fileChangeRefreshKey={fileChangeRefreshKey}
                fileChangesMap={fileChangesMap}
                handleBlockToggle={handleBlockToggle}
                onFileClick={onFileClick}
              />
            );
          })}

          {(isWaitingReply || streamingData.length > 0) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
                  <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatSmartTime(new Date().toISOString())}</Text>
                </div>
                {isWaitingReply && streamingData.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 14, height: 14, border: '2px solid var(--bg-300)', borderTopColor: 'var(--primary-100)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <Text style={{ fontSize: 14, color: 'var(--text-200)' }}>正在思考...</Text>
                  </div>
                )}
                {streamingGroups.map((group, groupIdx) => {
                  const isMainAgent = group.agent_level === 0;
                  const borderColor = getSubagentColor(group.agent_level);
                  const blocks = group.blocks.map((block, idx) => {
                    const blockKey = `streaming-${idx}`;
                    return (
                      <DataBlockItem
                        key={idx}
                        block={block}
                        idx={idx}
                        msgId="streaming"
                        onToggle={handleBlockToggle}
                        blockKey={blockKey}
                        fileChangesMap={fileChangesMap}
                        allBlocks={streamingData}
                      />
                    );
                  });
                  if (isMainAgent) return <React.Fragment key={groupIdx}>{blocks}</React.Fragment>;
                  return (
                    <div key={groupIdx} style={{ marginLeft: 14 * group.agent_level, marginTop: 8, borderLeft: `3px solid ${borderColor}`, paddingLeft: 12, background: 'rgba(63, 81, 181, 0.05)', borderRadius: 6, paddingBottom: 8 }}>
                      <div style={{ marginBottom: 4 }}><Text style={{ fontSize: 13, color: borderColor, fontWeight: 500 }}>{group.agent_name}</Text></div>
                      {blocks}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}
    </>
  );
});

export default MessageList;
