import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Typography, Dropdown, message } from 'antd';
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
import EditorLoader, { getEditorForFile } from '../editors';
import { useOfficeConfigStore } from '../stores/officeConfigStore';
import { getFileCategory, getFileColor } from '../utils/fileTypeUtils';

const { Text } = Typography;

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

  const openPanels = panels.filter(p => p.isOpen);
  const unopenedPanels = panels.filter(p => !p.isOpen);

  useEffect(() => {
    if (openPanels.length > 0 && !panels.find(p => p.type === activeTab && p.isOpen)) {
      onSetActiveTab(openPanels[0].type);
    }
  }, [openPanels, activeTab, panels, onSetActiveTab]);

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
