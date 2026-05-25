import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Typography, Dropdown, App, Tag, Spin, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  EditOutlined,
  CodeOutlined,
  GlobalOutlined,
  FileTextOutlined,
  FileOutlined,
  DesktopOutlined,
  PlusOutlined,
  ClearOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons';
import type { AgenticPanel as AgenticPanelType, FileTab } from '../types';
import EditorLoader, { getEditorForFile } from '../editors';
import { useOfficeConfigStore } from '../stores/officeConfigStore';
import { useRunPanelStore } from '../stores/runPanelStore';
import { fileChangesApi } from '../../../services/fileChangesApi';
import FileDiffViewer from './FileDiffViewer';
import { getFileCategory, getFileColor } from '../utils/fileTypeUtils';
import '../styles/FileChangeStyles.css';

const { Text } = Typography;

const codeExtensions = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'less', 'html', 'vue', 'svelte', 'json', 'yaml', 'yml', 'xml', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'rb', 'php', 'swift', 'kt', 'scala', 'r', 'm', 'mm', 'lua', 'pl', 'dart', 'md', 'toml', 'ini', 'cfg']);

const ChangesTabContent: React.FC = () => {
  const fileChangesMap = useRunPanelStore(s => s.fileChangesMap);
  const activeChangesMessageId = useRunPanelStore(s => s.activeChangesMessageId);
  const currentSessionId = useRunPanelStore(s => s.currentSessionId);
  const fileChangeRefreshKey = useRunPanelStore(s => s.fileChangeRefreshKey);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [diffContents, setDiffContents] = useState<Record<string, { oldContent: string; newContent: string }>>({});
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedFiles(new Set());
    setDiffContents({});
    setLoadingFiles(new Set());
  }, [activeChangesMessageId, fileChangeRefreshKey]);

  const changes = activeChangesMessageId ? fileChangesMap[activeChangesMessageId] : undefined;

  const toggleFile = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
        if (!diffContents[filePath] && currentSessionId && activeChangesMessageId) {
          loadDiffContent(filePath);
        }
      }
      return next;
    });
  };

  const loadDiffContent = async (filePath: string) => {
    if (!currentSessionId || !activeChangesMessageId) return;

    setLoadingFiles(prev => new Set(prev).add(filePath));
    try {
      const response = await fileChangesApi.getMessageFileContent(currentSessionId, activeChangesMessageId);
      const data = (response as any)?.data || response;
      const targetChange = data?.changes?.find((c: any) => c.file_path === filePath);
      if (targetChange) {
        setDiffContents(prev => ({
          ...prev,
          [filePath]: {
            oldContent: targetChange.before_content || '',
            newContent: targetChange.after_content || '',
          }
        }));
      }
    } catch (error) {
      console.error('[ChangesTabContent] Failed to load diff:', error);
    } finally {
      setLoadingFiles(prev => { const next = new Set(prev); next.delete(filePath); return next; });
    }
  };

  if (!changes || changes.length === 0) {
    return (
      <div className="sc-changes-empty">
        <FileOutlined className="sc-changes-empty-icon" />
        <Text className="sc-changes-empty-text">暂无文件变更记录</Text>
      </div>
    );
  }

  return (
    <div className="sc-changes-panel">
      {changes.map((change, index) => {
        const fileName = change.file_path.split(/[\\/]/).pop() || change.file_path;
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const isExpanded = expandedFiles.has(change.file_path);
        const isLoading = loadingFiles.has(change.file_path);
        const diffContent = diffContents[change.file_path];

        let opLabel = '修改';
        let opColor = '#1565c0';
        if (change.operation === 'created') { opLabel = '新建'; opColor = '#2e7d32'; }
        else if (change.operation === 'deleted') { opLabel = '删除'; opColor = '#c62828'; }

        const added = change.diff?.lines_added ?? 0;
        const removed = change.diff?.lines_removed ?? 0;

        return (
          <div key={change.file_path || index} className="sc-changes-file-block">
            <div
              className="sc-changes-file-row"
              onClick={() => toggleFile(change.file_path)}
            >
              <div className="sc-changes-file-row-left">
                {codeExtensions.has(ext) ? (
                  <CodeOutlined className="sc-changes-file-row-icon" />
                ) : (
                  <FileOutlined className="sc-changes-file-row-icon" />
                )}
                <Tag color={opColor} className="sc-changes-file-row-op">{opLabel}</Tag>
                <span className="sc-changes-file-row-name">{fileName}</span>
              </div>
              <div className="sc-changes-file-row-right">
                <span className="sc-changes-file-row-added">+{added}</span>
                <span className="sc-changes-file-row-removed">-{removed}</span>
                <span className="sc-changes-file-row-toggle">
                  {isLoading ? <Spin size="small" /> : isExpanded ? <UpOutlined /> : <DownOutlined />}
                </span>
              </div>
            </div>
            {isExpanded && (
              <div className="sc-changes-file-diff">
                {isLoading ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <Spin size="small" />
                  </div>
                ) : diffContent ? (
                  <FileDiffViewer
                    filePath={change.file_path}
                    oldContent={diffContent.oldContent}
                    newContent={diffContent.newContent}
                    hideHeader
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>无法加载差异内容</Text>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

interface AgenticPanelProps {
  panels: AgenticPanelType[];
  activeTab: string | null;
  editorTabs: FileTab[];
  documentTabs: FileTab[];
  activeEditorTabId: string | null;
  activeDocumentTabId: string | null;
  onOpenPanel: (type: string) => void;
  onClosePanel: (id: string) => void;
  onSetActiveTab: (tab: string | null) => void;
  onSetActiveEditorTabId: (id: string | null) => void;
  onSetActiveDocumentTabId: (id: string | null) => void;
  onCloseEditorTab: (id: string, e?: React.MouseEvent) => void;
  onCloseDocumentTab: (id: string, e?: React.MouseEvent) => void;
  onEditorContentChange: (tabId: string, content: string) => void;
  onDocumentContentChange: (tabId: string, content: string) => void;
  onAutoSave: (tab: FileTab) => void;
}

const AgenticPanel: React.FC<AgenticPanelProps> = ({
  panels,
  activeTab,
  editorTabs,
  documentTabs,
  activeEditorTabId,
  activeDocumentTabId,
  onOpenPanel,
  onClosePanel,
  onSetActiveTab,
  onSetActiveEditorTabId,
  onSetActiveDocumentTabId,
  onCloseEditorTab,
  onCloseDocumentTab,
  onEditorContentChange,
  onDocumentContentChange,
  onAutoSave,
}) => {
  const { message } = App.useApp();
  const [verticalSplitRatio, setVerticalSplitRatio] = useState(0.5);
  const [isVerticalDragging, setIsVerticalDragging] = useState(false);
  const [verticalDragStartY, setVerticalDragStartY] = useState(0);
  const [verticalDragStartRatio, setVerticalDragStartRatio] = useState(0.5);
  
  const { checkAvailability, config } = useOfficeConfigStore();

  useEffect(() => {
    if (config.checkStatus === 'idle') {
      checkAvailability();
    }
  }, [config.checkStatus, checkAvailability]);

  const getAgenticPanelIcon = (type: string) => {
    switch (type) {
      case 'editor': return <EditOutlined />;
      case 'terminal': return <CodeOutlined />;
      case 'browser': return <GlobalOutlined />;
      case 'document': return <FileTextOutlined />;
      case 'changes': return <FileOutlined />;
      default: return <DesktopOutlined />;
    }
  };

  const openPanels = useMemo(() => panels.filter(p => p.isOpen), [panels]);
  const unopenedPanels = useMemo(() => panels.filter(p => !p.isOpen), [panels]);

  const onSetActiveTabRef = useRef(onSetActiveTab);
  onSetActiveTabRef.current = onSetActiveTab;

  useEffect(() => {
    if (openPanels.length > 0 && !panels.find(p => p.type === activeTab && p.isOpen)) {
      onSetActiveTabRef.current(openPanels[0].type);
    }
  }, [openPanels.length, activeTab, panels]);

  const panelMenuItems: MenuProps['items'] = unopenedPanels.map(panel => ({
    key: panel.id,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {getAgenticPanelIcon(panel.type)}
        {panel.title}
      </span>
    ),
    onClick: () => onOpenPanel(panel.type),
  }));

  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsVerticalDragging(true);
    setVerticalDragStartY(e.clientY);
    setVerticalDragStartRatio(verticalSplitRatio);
  }, [verticalSplitRatio]);

  const handleVerticalMouseMove = useCallback((e: MouseEvent) => {
    if (!isVerticalDragging) return;

    const agenticPanel = document.getElementById('agentic-panel-content');
    if (!agenticPanel) return;

    const rect = agenticPanel.getBoundingClientRect();
    const deltaY = e.clientY - verticalDragStartY;
    const deltaRatio = deltaY / rect.height;

    let newRatio = verticalDragStartRatio + deltaRatio;
    newRatio = Math.max(0.2, Math.min(0.8, newRatio));

    setVerticalSplitRatio(newRatio);
  }, [isVerticalDragging, verticalDragStartY, verticalDragStartRatio]);

  const handleVerticalMouseUp = useCallback(() => {
    setIsVerticalDragging(false);
  }, []);

  useEffect(() => {
    if (isVerticalDragging) {
      document.addEventListener('mousemove', handleVerticalMouseMove);
      document.addEventListener('mouseup', handleVerticalMouseUp);
    } else {
      document.removeEventListener('mousemove', handleVerticalMouseMove);
      document.removeEventListener('mouseup', handleVerticalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleVerticalMouseMove);
      document.removeEventListener('mouseup', handleVerticalMouseUp);
    };
  }, [isVerticalDragging, handleVerticalMouseMove, handleVerticalMouseUp]);

  const hasEditor = openPanels.some(p => p.type === 'editor');
  const hasTerminal = openPanels.some(p => p.type === 'terminal');
  const showSplit = hasEditor && hasTerminal && (activeTab === 'editor' || activeTab === 'terminal');

  const renderFileTab = (
    tab: FileTab, 
    isActive: boolean, 
    onSelect: () => void, 
    onClose: (e: React.MouseEvent) => void,
    icon: React.ReactNode
  ) => (
    <div
      key={tab.id}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        cursor: 'pointer',
        background: isActive ? 'var(--bg-100)' : 'transparent',
        borderRight: '1px solid var(--bg-300)',
        minWidth: 80,
        maxWidth: 150,
      }}
    >
      {icon}
      <Text style={{ 
        fontSize: 11, 
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {tab.name}
      </Text>
      {tab.hasExternalChange && (
        <Tag color="warning" style={{ margin: '0 2px', fontSize: 9, padding: '0 4px', lineHeight: '14px' }}>
          外部修改
        </Tag>
      )}
      {tab.isModified && <span style={{ color: 'var(--warning)', fontSize: 10 }}>●</span>}
      <ClearOutlined 
        style={{ fontSize: 9, color: 'var(--text-300)', marginLeft: 2 }}
        onClick={onClose}
      />
    </div>
  );

  const activeEditorTab = useMemo(() => 
    editorTabs.find(t => t.id === activeEditorTabId),
    [editorTabs, activeEditorTabId]
  );

  const activeDocumentTab = useMemo(() => 
    documentTabs.find(t => t.id === activeDocumentTabId),
    [documentTabs, activeDocumentTabId]
  );

  const renderEditorPanel = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {editorTabs.length > 0 ? (
        <>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            background: 'var(--bg-200)',
            borderBottom: '1px solid var(--bg-300)',
            overflowX: 'auto',
            minHeight: 32,
          }}>
            {editorTabs.map(tab => renderFileTab(
              tab,
              activeEditorTabId === tab.id,
              () => onSetActiveEditorTabId(tab.id),
              (e) => onCloseEditorTab(tab.id, e),
              <EditOutlined style={{ fontSize: 10, color: getFileColor(tab.name) }} />
            ))}
            {activeEditorTab?.hasExternalChange && (
              <Tooltip title="重新加载磁盘内容（放弃当前修改）">
                <Button
                  type="text"
                  size="small"
                  onClick={() => useRunPanelStore.getState().resolveExternalChange(activeEditorTab.id)}
                  style={{ color: 'var(--warning)', fontSize: 11, padding: '0 8px' }}
                >
                  重新加载
                </Button>
              </Tooltip>
            )}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeEditorTab ? (
              <EditorLoader
                tab={activeEditorTab}
                onContentChange={onEditorContentChange}
                onSave={onAutoSave}
              />
            ) : (
              <div style={{ 
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text type="secondary" style={{ fontSize: 11 }}>选择文件查看内容</Text>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ 
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text type="secondary" style={{ fontSize: 11 }}>点击文件查看内容</Text>
        </div>
      )}
    </div>
  );

  const renderDocumentPanel = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {documentTabs.length > 0 ? (
        <>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            background: 'var(--bg-200)',
            borderBottom: '1px solid var(--bg-300)',
            overflowX: 'auto',
            minHeight: 32,
          }}>
            {documentTabs.map(tab => renderFileTab(
              tab,
              activeDocumentTabId === tab.id,
              () => onSetActiveDocumentTabId(tab.id),
              (e) => onCloseDocumentTab(tab.id, e),
              <FileTextOutlined style={{ fontSize: 10, color: getFileColor(tab.name) }} />
            ))}
            {activeDocumentTab?.hasExternalChange && (
              <Tooltip title="重新加载磁盘内容（放弃当前修改）">
                <Button
                  type="text"
                  size="small"
                  onClick={() => useRunPanelStore.getState().resolveExternalChange(activeDocumentTab.id)}
                  style={{ color: 'var(--warning)', fontSize: 11, padding: '0 8px' }}
                >
                  重新加载
                </Button>
              </Tooltip>
            )}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeDocumentTab ? (
              <EditorLoader
                tab={activeDocumentTab}
                onContentChange={onDocumentContentChange}
                onSave={onAutoSave}
              />
            ) : (
              <div style={{ 
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text type="secondary" style={{ fontSize: 11 }}>选择文件查看内容</Text>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ 
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text type="secondary" style={{ fontSize: 11 }}>点击文件查看内容</Text>
        </div>
      )}
    </div>
  );

  return (
    <div style={{
      background: 'var(--bg-100)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      flexShrink: 0,
      borderRight: '1px solid var(--bg-300)',
      height: '100%',
    }}>
      <div style={{ 
        borderBottom: '1px solid var(--bg-300)',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bg-100)',
        height: 45,
        padding: '0 8px',
      }}>
        <Text strong style={{ fontSize: 13, color: 'var(--text-100)', padding: '0 8px', whiteSpace: 'nowrap' }}>Agentic操作区</Text>
        
        {openPanels.length > 0 && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            height: '100%',
            marginLeft: 8,
            borderLeft: '1px solid var(--bg-300)',
            paddingLeft: 8,
          }}>
            {openPanels.map(panel => (
              <div
                key={panel.id}
                onClick={() => onSetActiveTab(panel.type)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  background: activeTab === panel.type ? 'var(--bg-200)' : 'transparent',
                  borderRadius: 6,
                  marginRight: 4,
                  transition: 'background 0.15s',
                }}
              >
                {getAgenticPanelIcon(panel.type)}
                <Text style={{ 
                  fontSize: 12, 
                  color: activeTab === panel.type ? 'var(--text-100)' : 'var(--text-300)',
                  fontWeight: activeTab === panel.type ? 500 : 400,
                }}>
                  {panel.title}
                </Text>
                <ClearOutlined 
                  style={{ fontSize: 10, color: 'var(--text-300)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClosePanel(panel.id);
                  }}
                />
              </div>
            ))}
          </div>
        )}
        
        <div style={{ flex: 1 }} />
        
        {unopenedPanels.length > 0 && (
          <Dropdown menu={{ items: panelMenuItems }} trigger={['click']} placement="bottomRight">
            <Button 
              type="text" 
              size="small" 
              icon={<PlusOutlined />}
              style={{ 
                color: 'var(--primary-100)',
                width: 28,
                height: 28,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          </Dropdown>
        )}
      </div>
      
      <div id="agentic-panel-content" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {openPanels.length === 0 ? (
          <div style={{ 
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'var(--bg-200)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
            }}>
              <DesktopOutlined style={{ fontSize: 20, color: 'var(--text-300)' }} />
            </div>
            <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>点击 + 打开操作面板</Text>
          </div>
        ) : showSplit ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ 
              height: `${verticalSplitRatio * 100}%`, 
              overflow: 'hidden',
              borderBottom: '1px solid var(--bg-300)',
              background: 'var(--bg-100)',
            }}>
              {renderEditorPanel()}
            </div>
            
            <div
              onMouseDown={handleVerticalMouseDown}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${verticalSplitRatio * 100}%`,
                height: 6,
                cursor: 'row-resize',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: 'translateY(-50%)',
              }}
            >
              <div style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: isVerticalDragging ? 'var(--primary-100)' : 'var(--bg-300)',
                transition: isVerticalDragging ? 'none' : 'background 0.2s',
              }} />
            </div>
            
            <div style={{ 
              height: `${(1 - verticalSplitRatio) * 100}%`, 
              overflow: 'hidden',
              background: 'var(--bg-100)',
            }}>
              <div style={{ 
                padding: '8px 12px', 
                borderBottom: '1px solid var(--bg-300)',
                background: 'var(--bg-200)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <CodeOutlined style={{ fontSize: 12, color: 'var(--accent-100)' }} />
                <Text style={{ fontSize: 11, fontWeight: 500 }}>终端</Text>
              </div>
              <div style={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>终端命令行区域</Text>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {(() => {
              const activePanel = panels.find(p => p.type === activeTab && p.isOpen);
              if (!activePanel) return null;
              
              switch (activePanel.type) {
                case 'editor':
                  return renderEditorPanel();
                case 'terminal':
                  return (
                    <>
                      <div style={{ 
                        padding: '8px 12px', 
                        borderBottom: '1px solid var(--bg-300)',
                        background: 'var(--bg-200)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <CodeOutlined style={{ fontSize: 12, color: 'var(--accent-100)' }} />
                        <Text style={{ fontSize: 11, fontWeight: 500 }}>终端</Text>
                      </div>
                      <div style={{ padding: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>终端命令行区域</Text>
                      </div>
                    </>
                  );
                case 'browser':
                  return (
                    <>
                      <div style={{ 
                        padding: '8px 12px', 
                        borderBottom: '1px solid var(--bg-300)',
                        background: 'var(--bg-200)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <GlobalOutlined style={{ fontSize: 12, color: 'var(--primary-100)' }} />
                        <Text style={{ fontSize: 11, fontWeight: 500 }}>浏览器</Text>
                      </div>
                      <div style={{ padding: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>浏览器预览区域</Text>
                      </div>
                    </>
                  );
                case 'document':
                  return renderDocumentPanel();
                case 'changes':
                  return <ChangesTabContent />;
                default:
                  return null;
              }
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgenticPanel;
