/**
 * @file components/AgenticPanel.tsx
 * @description Agentic操作区面板组件
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button, Typography, Spin, Dropdown, Input, message } from 'antd';
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
} from '@ant-design/icons';
import type { AgenticPanel as AgenticPanelType, FileTab } from '../types';

const { Text } = Typography;
const { TextArea } = Input;

const isCodeFile = (fileName: string): boolean => {
  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'rb', 'php', 'cs', 'swift', 'kt', 'scala', 'vue', 'svelte', 'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'ps1', 'bat', 'sql', 'log', 'ini', 'conf', 'cfg', 'env', 'toml'];
  const ext = fileName.split('.').pop()?.toLowerCase();
  return codeExtensions.includes(ext || '');
};

const isMarkdownFile = (fileName: string): boolean => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'md' || ext === 'markdown';
};

const renderMarkdown = (content: string): string => {
  return content
    .replace(/^### (.*$)/gim, '<h3 style="font-size: 16px; font-weight: 600; margin: 16px 0 8px 0; color: #333;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="font-size: 18px; font-weight: 600; margin: 20px 0 10px 0; color: #333;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="font-size: 22px; font-weight: 700; margin: 24px 0 12px 0; color: #333;">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-family: Consolas, Monaco, monospace; font-size: 12px;">$1</code>')
    .replace(/^```(\w*)$/gim, '<pre style="background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0;"><code>')
    .replace(/^```$/gim, '</code></pre>')
    .replace(/^- (.*$)/gim, '<li style="margin-left: 20px;">$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li style="margin-left: 20px; list-style-type: decimal;">$1</li>')
    .replace(/\n/g, '<br/>');
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
  const [verticalSplitRatio, setVerticalSplitRatio] = useState(0.5);
  const [isVerticalDragging, setIsVerticalDragging] = useState(false);
  const [verticalDragStartY, setVerticalDragStartY] = useState(0);
  const [verticalDragStartRatio, setVerticalDragStartRatio] = useState(0.5);

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

  const unopenedPanels = panels.filter(p => !p.isOpen);
  
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

  const openPanels = panels.filter(p => p.isOpen);
  const hasEditor = openPanels.some(p => p.type === 'editor');
  const hasTerminal = openPanels.some(p => p.type === 'terminal');
  const showSplit = hasEditor && hasTerminal && (activeTab === 'editor' || activeTab === 'terminal');

  const renderEditorPanel = () => (
    <>
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
            {editorTabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => onSetActiveEditorTabId(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  background: activeEditorTabId === tab.id ? 'var(--bg-100)' : 'transparent',
                  borderRight: '1px solid var(--bg-300)',
                  minWidth: 80,
                  maxWidth: 150,
                }}
              >
                <EditOutlined style={{ fontSize: 10, color: 'var(--primary-100)' }} />
                <Text style={{ 
                  fontSize: 11, 
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {tab.name}
                </Text>
                {tab.isModified && <span style={{ color: 'var(--warning)', fontSize: 10 }}>●</span>}
                <ClearOutlined 
                  style={{ fontSize: 9, color: 'var(--text-300)', marginLeft: 2 }}
                  onClick={(e) => onCloseEditorTab(tab.id, e)}
                />
              </div>
            ))}
          </div>
          {(() => {
            const activeTab = editorTabs.find(t => t.id === activeEditorTabId);
            if (!activeTab) return null;
            return (
              <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '12px 0 12px 12px' }}>
                {activeTab.isLoading ? (
                  <div style={{ padding: 12 }}><Spin size="small" /></div>
                ) : activeTab.isBinary ? (
                  <div style={{
                    background: '#e6f4ff',
                    borderRadius: 8,
                    padding: 16,
                    marginRight: 12,
                  }}>
                    <pre style={{ 
                      margin: 0, 
                      fontSize: 12, 
                      fontFamily: 'Consolas, Monaco, monospace',
                      whiteSpace: 'pre-wrap',
                      color: 'var(--text-300)',
                    }}>
                      {activeTab.content}
                    </pre>
                  </div>
                ) : (
                  <div style={{
                    background: '#e6f4ff',
                    borderRadius: 8,
                    padding: 16,
                    height: '100%',
                    boxSizing: 'border-box',
                    marginRight: 12,
                  }}>
                    <TextArea
                      value={activeTab.content}
                      onChange={(e) => onEditorContentChange(activeTab.id, e.target.value)}
                      onBlur={() => {
                        if (activeTab.isModified) {
                          onAutoSave(activeTab);
                        }
                      }}
                      bordered={false}
                      styles={{
                        textarea: { background: 'transparent' }
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        fontSize: 12,
                        fontFamily: 'Consolas, Monaco, monospace',
                        lineHeight: 1.5,
                        background: 'transparent',
                        color: '#333',
                        padding: 0,
                        boxShadow: 'none',
                      }}
                      autoSize={false}
                    />
                  </div>
                )}
              </div>
            );
          })()}
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
    </>
  );

  const renderDocumentPanel = () => (
    <>
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
            {documentTabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => onSetActiveDocumentTabId(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  background: activeDocumentTabId === tab.id ? 'var(--bg-100)' : 'transparent',
                  borderRight: '1px solid var(--bg-300)',
                  minWidth: 80,
                  maxWidth: 150,
                }}
              >
                <FileTextOutlined style={{ fontSize: 10, color: 'var(--primary-100)' }} />
                <Text style={{ 
                  fontSize: 11, 
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {tab.name}
                </Text>
                {tab.isModified && <span style={{ color: 'var(--warning)', fontSize: 10 }}>●</span>}
                <ClearOutlined 
                  style={{ fontSize: 9, color: 'var(--text-300)', marginLeft: 2 }}
                  onClick={(e) => onCloseDocumentTab(tab.id, e)}
                />
              </div>
            ))}
          </div>
          {(() => {
            const activeTab = documentTabs.find(t => t.id === activeDocumentTabId);
            if (!activeTab) return null;
            return (
              <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '12px 0 12px 12px' }}>
                {activeTab.isLoading ? (
                  <div style={{ padding: 12 }}><Spin size="small" /></div>
                ) : activeTab.isBinary ? (
                  <div style={{
                    background: '#e6f4ff',
                    borderRadius: 8,
                    padding: 16,
                    marginRight: 12,
                  }}>
                    <pre style={{ 
                      margin: 0, 
                      fontSize: 12, 
                      whiteSpace: 'pre-wrap',
                      color: 'var(--text-300)',
                    }}>
                      {activeTab.content}
                    </pre>
                  </div>
                ) : isMarkdownFile(activeTab.name) ? (
                  <div style={{
                    background: '#e6f4ff',
                    borderRadius: 8,
                    padding: 16,
                    height: '100%',
                    boxSizing: 'border-box',
                    overflow: 'auto',
                    marginRight: 12,
                  }}>
                    <div 
                      dangerouslySetInnerHTML={{ 
                        __html: renderMarkdown(activeTab.content) 
                      }}
                      style={{
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: '#333',
                      }}
                    />
                  </div>
                ) : (
                  <div style={{
                    background: '#e6f4ff',
                    borderRadius: 8,
                    padding: 16,
                    height: '100%',
                    boxSizing: 'border-box',
                    marginRight: 12,
                  }}>
                    <TextArea
                      value={activeTab.content}
                      onChange={(e) => onDocumentContentChange(activeTab.id, e.target.value)}
                      onBlur={() => {
                        if (activeTab.isModified) {
                          onAutoSave(activeTab);
                        }
                      }}
                      bordered={false}
                      styles={{
                        textarea: { background: 'transparent' }
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        fontSize: 13,
                        lineHeight: 1.6,
                        background: 'transparent',
                        color: '#333',
                        padding: 0,
                        boxShadow: 'none',
                      }}
                      autoSize={false}
                    />
                  </div>
                )}
              </div>
            );
          })()}
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
    </>
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
              overflow: 'auto',
              borderBottom: '1px solid var(--bg-300)',
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
                <EditOutlined style={{ fontSize: 12, color: 'var(--primary-100)' }} />
                <Text style={{ fontSize: 11, fontWeight: 500 }}>编辑器</Text>
              </div>
              <div style={{ padding: 12 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>代码编辑器区域</Text>
              </div>
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
              overflow: 'auto',
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
              if (!activePanel && openPanels.length > 0) {
                onSetActiveTab(openPanels[0].type);
                return null;
              }
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
                        <FileOutlined style={{ fontSize: 12, color: 'var(--primary-100)' }} />
                        <Text style={{ fontSize: 11, fontWeight: 500 }}>文档变更</Text>
                      </div>
                      <div style={{ padding: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>文档变更记录</Text>
                      </div>
                    </>
                  );
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
