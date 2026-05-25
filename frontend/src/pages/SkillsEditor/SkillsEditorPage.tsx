/**
 * @file SkillsEditorPage.tsx
 * @description Skills编辑页面 - 左资源管理器，右侧文档编辑
 * @author SoloEngine Team
 * @date 2026-02-23
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Layout, Tree, Input, Button, App, Modal, Empty, Typography, Spin, Dropdown, Tooltip } from 'antd';
import type { MenuProps, TreeProps } from 'antd';
import {
  FileOutlined,
  FolderOutlined,
  FileMarkdownOutlined,
  FileTextOutlined,
  DeleteOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  MoreOutlined,
  EditOutlined,
  UndoOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import { skillsApi } from '../../services/skillsApi';
import MarkdownEditor from '../../components/RunPanel/editors/MarkdownEditor';

const { Sider, Content } = Layout;
const { TextArea } = Input;
const { Title, Text } = Typography;

interface FileNode {
  key: string;
  title: string;
  isLeaf?: boolean;
  children?: FileNode[];
  description?: string;
}

interface PackageInfo {
  id: string;
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  pkg_version?: string;
  is_default?: boolean;
}

interface HistoryState {
  content: string;
  timestamp: number;
}

const MAX_HISTORY_SIZE = 100;

const SkillsEditorPage: React.FC = () => {
  const { message } = App.useApp();
  const { packageId } = useParams<{ packageId: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packageInfo, setPackageInfo] = useState<PackageInfo | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [newItemModalVisible, setNewItemModalVisible] = useState(false);
  const [newItemType, setNewItemType] = useState<'file' | 'folder'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [newItemParent, setNewItemParent] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [folderDescModalVisible, setFolderDescModalVisible] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [folderDescription, setFolderDescription] = useState('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textAreaRef = useRef<any>(null);
  
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false);

  // 侧边栏宽度拖拽相关状态
  const [siderWidth, setSiderWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(280);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = siderWidth;
    e.preventDefault();
  }, [siderWidth]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const delta = e.clientX - resizeStartX.current;
    const newWidth = Math.max(200, Math.min(500, resizeStartWidth.current + delta));
    setSiderWidth(newWidth);
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const loadPackageData = useCallback(async () => {
    if (!packageId) return;
    setLoading(true);
    try {
      const [pkgRes, filesRes] = await Promise.all([
        skillsApi.getPackage(packageId),
        skillsApi.getPackageFiles(packageId),
      ]);
      
      if (pkgRes.code === 200) {
        setPackageInfo(pkgRes.data);
      }
      
      if (filesRes.code === 200 && filesRes.data?.files) {
        setFileTree(filesRes.data.files);
        const allFolderKeys = getAllFolderKeys(filesRes.data.files);
        setExpandedKeys(allFolderKeys);
      } else if (filesRes.code === 400 && filesRes.data?.need_activate) {
        message.warning('请先激活此Skills包后再编辑');
        setTimeout(() => {
          window.close();
        }, 1500);
      }
    } catch (error) {
      message.error('加载Skills包信息失败');
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  const getAllFolderKeys = (nodes: FileNode[], _parentKey: string = ''): string[] => {
    const keys: string[] = [];
    for (const node of nodes) {
      if (!node.isLeaf) {
        keys.push(node.key);
        if (node.children) {
          keys.push(...getAllFolderKeys(node.children, node.key));
        }
      }
    }
    return keys;
  };

  const loadFileContent = useCallback(async (filePath: string) => {
    if (!packageId) return;
    try {
      const res = await skillsApi.getFileContent(packageId, filePath);
      if (res.code === 200) {
        const content = res.data?.content || '';
        setFileContent(content);
        setHasUnsavedChanges(false);
        setHistory([{ content, timestamp: Date.now() }]);
        setHistoryIndex(0);
      }
    } catch (error) {
      message.error('加载文件内容失败');
      setFileContent('');
    }
  }, [packageId]);

  const handleSave = useCallback(async (showMessage = true) => {
    if (!packageId || !selectedFile) return;
    setSaving(true);
    try {
      const res = await skillsApi.saveFile(packageId, selectedFile, fileContent);
      if (res.code === 200) {
        setHasUnsavedChanges(false);
        if (showMessage) {
          message.success('文件已保存');
        }
      }
    } catch (error) {
      if (showMessage) {
        message.error('保存失败');
      }
    } finally {
      setSaving(false);
    }
  }, [packageId, selectedFile, fileContent]);

  useEffect(() => {
    if (hasUnsavedChanges && selectedFile) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        handleSave(false);
      }, 2000);
    }
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [fileContent, hasUnsavedChanges, selectedFile, handleSave]);

  const handleFileSelect: TreeProps['onSelect'] = (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      const key = selectedKeys[0] as string;
      const node = info.node;
      
      if (node.isLeaf) {
        if (hasUnsavedChanges && selectedFile) {
          handleSave(false);
        }
        setSelectedFile(key);
        loadFileContent(key);
      } else {
        const isExpanded = expandedKeys.includes(key);
        if (isExpanded) {
          setExpandedKeys(expandedKeys.filter(k => k !== key));
        } else {
          setExpandedKeys([...expandedKeys, key]);
        }
      }
    }
  };

  const handleExpand: TreeProps['onExpand'] = (expandedKeys) => {
    setExpandedKeys(expandedKeys as string[]);
  };

  const handleCreateItem = async () => {
    if (!packageId || !newItemName.trim()) {
      message.warning('请输入名称');
      return;
    }
    
    const filePath = newItemParent 
      ? `${newItemParent}/${newItemName}` 
      : newItemName;
    
    try {
      const res = await skillsApi.createFileOrFolder(
        packageId, 
        filePath, 
        newItemType === 'folder'
      );
      if (res.code === 200) {
        message.success(`${newItemType === 'folder' ? '文件夹' : '文件'} "${newItemName}" 已创建`);
        setNewItemModalVisible(false);
        setNewItemName('');
        setNewItemParent('');
        loadPackageData();
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败');
    }
  };

  const handleDeleteItem = async (filePath: string) => {
    if (!packageId) return;
    
    const isSkillMd = filePath === 'SKILL.md';
    
    Modal.confirm({
      title: isSkillMd ? '删除核心文件' : '删除项目',
      content: isSkillMd 
        ? 'SKILL.md 是Skills包的核心文件，删除后可能影响Skills包的功能。确定要删除吗？'
        : '确定要删除此项目吗？此操作不可恢复。',
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await skillsApi.deleteFileOrFolder(packageId, filePath);
          if (res.code === 200) {
            message.success('已删除');
            if (selectedFile === filePath) {
              setSelectedFile(null);
              setFileContent('');
              setHasUnsavedChanges(false);
            }
            loadPackageData();
          }
        } catch (error: any) {
          message.error(error.response?.data?.detail || '删除失败');
        }
      },
    });
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    isUndoRedoAction.current = true;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setFileContent(history[newIndex].content);
    setHasUnsavedChanges(true);
  }, [canUndo, historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    isUndoRedoAction.current = true;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setFileContent(history[newIndex].content);
    setHasUnsavedChanges(true);
  }, [canRedo, historyIndex, history]);

  const handleContentChange = (newContent: string) => {
    setFileContent(newContent);
    setHasUnsavedChanges(true);
    
    if (!isUndoRedoAction.current) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push({
        content: newContent,
        timestamp: Date.now(),
      });
      
      if (newHistory.length > MAX_HISTORY_SIZE) {
        newHistory.shift();
      }
      
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
    
    isUndoRedoAction.current = false;
  };

  const getContextMenuItems = (node: any): MenuProps['items'] => {
    const items: MenuProps['items'] = [
      {
        key: 'newFile',
        icon: <FileAddOutlined />,
        label: '新建文件',
        onClick: () => {
          setNewItemType('file');
          setNewItemParent(node.isLeaf ? '' : node.key);
          setNewItemModalVisible(true);
        },
      },
      {
        key: 'newFolder',
        icon: <FolderAddOutlined />,
        label: '新建文件夹',
        onClick: () => {
          setNewItemType('folder');
          setNewItemParent(node.isLeaf ? '' : node.key);
          setNewItemModalVisible(true);
        },
      },
    ];

    if (!node.isLeaf) {
      items.push({
        key: 'description',
        icon: <EditOutlined />,
        label: '添加备注',
        onClick: () => {
          setSelectedFolder(node.key);
          setFolderDescription(node.description || '');
          setFolderDescModalVisible(true);
        },
      });
    }

    if (node.key !== '') {
      items.push({
        key: 'delete',
        icon: <DeleteOutlined />,
        label: '删除',
        danger: true,
        onClick: () => handleDeleteItem(node.key),
      });
    }

    return items;
  };

  const renderTreeNodes = (nodes: FileNode[]): any[] => {
    return nodes.map(node => ({
      key: node.key,
      title: (
        <Dropdown
          menu={{ items: getContextMenuItems(node) }}
          trigger={['contextMenu']}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
            {node.isLeaf ? (
              node.key.endsWith('.md') ? <FileMarkdownOutlined style={{ color: '#1890ff', flexShrink: 0 }} /> : <FileTextOutlined style={{ flexShrink: 0 }} />
            ) : (
              <FolderOutlined style={{ color: '#faad14', flexShrink: 0 }} />
            )}
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{node.title}</span>
          </span>
        </Dropdown>
      ),
      isLeaf: node.isLeaf,
      children: node.children ? renderTreeNodes(node.children) : undefined,
      description: node.description,
    }));
  };

  useEffect(() => {
    loadPackageData();
  }, [loadPackageData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (selectedFile) {
          handleSave(true);
        }
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, handleSave, handleUndo, handleRedo]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ height: '100vh', background: '#f5f5f5' }}>
      <div style={{
        height: 56,
        borderBottom: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 16,
        background: '#fff',
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => window.close()}
        >
          关闭窗口
        </Button>
        <div style={{ flex: 1 }}>
          <Title level={5} style={{ margin: 0 }}>
            {packageInfo?.name || 'Skills 编辑器'}
          </Title>
        </div>
        <Tooltip title="撤销 (Ctrl+Z)">
          <Button
            icon={<UndoOutlined />}
            onClick={handleUndo}
            disabled={!canUndo}
          >
            撤销
          </Button>
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Y)">
          <Button
            icon={<RedoOutlined />}
            onClick={handleRedo}
            disabled={!canRedo}
            style={{ marginRight: 8 }}
          >
            重做
          </Button>
        </Tooltip>
        <Button
          icon={<ReloadOutlined />}
          onClick={loadPackageData}
          title="刷新"
        >
          刷新
        </Button>
        <Button
          icon={<SaveOutlined />}
          type="primary"
          onClick={() => handleSave(true)}
          loading={saving}
        >
          保存
        </Button>
      </div>
      
      <Layout style={{ flex: 1, overflow: 'hidden' }}>
        <Sider
          width={siderWidth}
          style={{
            background: '#fff',
            borderRight: '1px solid #e8e8e8',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div style={{ 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column',
          }}>
            <div style={{ padding: '0 12px', borderBottom: '1px solid #e8e8e8', flexShrink: 0, height: 45, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 13 }}>资源管理器</Text>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  size="small"
                  type="text"
                  icon={<FileAddOutlined />}
                  onClick={() => { 
                    setNewItemType('file'); 
                    setNewItemParent('');
                    setNewItemModalVisible(true); 
                  }}
                  title="新建文件"
                />
                <Button
                  size="small"
                  type="text"
                  icon={<FolderAddOutlined />}
                  onClick={() => { 
                    setNewItemType('folder'); 
                    setNewItemParent('');
                    setNewItemModalVisible(true); 
                  }}
                  title="新建文件夹"
                />
              </div>
            </div>
            
            <div style={{ padding: '12px', overflow: 'auto', flex: 1 }}>
            {fileTree.length > 0 ? (
              <Tree
                showLine
                selectedKeys={selectedFile ? [selectedFile] : []}
                expandedKeys={expandedKeys}
                onSelect={handleFileSelect}
                onExpand={handleExpand}
                treeData={renderTreeNodes(fileTree)}
                style={{ background: 'transparent', fontSize: 13 }}
              />
            ) : (
              <Empty description="暂无文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
            </div>
          </div>
          {/* 拖拽调整宽度的边框 */}
          <div
            onMouseDown={handleResizeStart}
            style={{
              position: 'absolute',
              right: -3,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: 'col-resize',
              background: 'transparent',
              transition: 'background 0.2s',
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              if (!isResizing) {
                e.currentTarget.style.background = 'var(--primary-300, #dedeff)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isResizing) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <div style={{
              width: 2,
              height: 40,
              background: isResizing ? 'var(--primary-100, #3F51B5)' : 'var(--border-color-lighter, #e2e8f0)',
              borderRadius: 2,
              transition: 'background 0.2s',
            }} />
          </div>
        </Sider>
        
        <Content style={{ display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {selectedFile ? (
            <>
              <div style={{
                padding: '0 16px',
                borderBottom: '1px solid #e8e8e8',
                background: '#fafafa',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                height: 45,
              }}>
                <Text style={{ fontSize: 13 }}>
                  <FileOutlined style={{ marginRight: 8 }} />
                  {selectedFile}
                  {hasUnsavedChanges && <Text type="warning" style={{ marginLeft: 8 }}>(未保存)</Text>}
                </Text>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: '删除文件',
                        danger: true,
                        onClick: () => handleDeleteItem(selectedFile),
                      },
                    ],
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} size="small" />
                </Dropdown>
              </div>
              
              {selectedFile.endsWith('.md') ? (
                <MarkdownEditor
                  instanceId={`skill-editor-${selectedFile}`}
                  tab={{
                    id: selectedFile,
                    name: selectedFile.split('/').pop() || selectedFile,
                    path: selectedFile,
                    content: fileContent,
                    isModified: hasUnsavedChanges,
                    isLoading: false,
                    isBinary: false,
                    hasExternalChange: false,
                    type: 'markdown',
                  }}
                  canEdit={true}
                  onContentChange={(_tabId, content) => handleContentChange(content)}
                  onSave={(_tab) => handleSave(false)}
                  theme="light"
                />
              ) : (
                <TextArea
                  ref={textAreaRef}
                  value={fileContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 0,
                    fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", monospace',
                    fontSize: 14,
                    lineHeight: 1.6,
                    padding: 16,
                    resize: 'none',
                    backgroundColor: '#ffffff',
                    color: '#333',
                  }}
                  placeholder="在此输入代码..."
                  spellCheck={false}
                />
              )}
            </>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              color: '#999',
            }}>
              <FileMarkdownOutlined style={{ fontSize: 64, marginBottom: 16, color: '#d9d9d9' }} />
              <Text type="secondary">从左侧选择文件开始编辑</Text>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                右键点击文件夹或文件可进行更多操作
              </Text>
            </div>
          )}
        </Content>
      </Layout>

      <Modal
        title={newItemType === 'folder' ? '新建文件夹' : '新建文件'}
        open={newItemModalVisible}
        onOk={handleCreateItem}
        onCancel={() => {
          setNewItemModalVisible(false);
          setNewItemName('');
          setNewItemParent('');
        }}
        okText="创建"
        cancelText="取消"
      >
        {newItemParent && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            位置: {newItemParent}/
          </Text>
        )}
        <Input
          placeholder={newItemType === 'folder' ? '文件夹名称' : '文件名称（如：example.py）'}
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          onPressEnter={handleCreateItem}
          autoFocus
        />
      </Modal>

      <Modal
        title="文件夹备注"
        open={folderDescModalVisible}
        onOk={() => {
          setFileTree(prev => {
            const updateNode = (nodes: FileNode[]): FileNode[] => {
              return nodes.map(node => {
                if (node.key === selectedFolder) {
                  return { ...node, description: folderDescription };
                }
                if (node.children) {
                  return { ...node, children: updateNode(node.children) };
                }
                return node;
              });
            };
            return updateNode(prev);
          });
          setFolderDescModalVisible(false);
          message.success('备注已添加');
        }}
        onCancel={() => {
          setFolderDescModalVisible(false);
          setFolderDescription('');
        }}
        okText="保存"
        cancelText="取消"
      >
        <TextArea
          placeholder="输入文件夹备注说明..."
          value={folderDescription}
          onChange={(e) => setFolderDescription(e.target.value)}
          rows={4}
        />
      </Modal>
    </Layout>
  );
};

export default SkillsEditorPage;
