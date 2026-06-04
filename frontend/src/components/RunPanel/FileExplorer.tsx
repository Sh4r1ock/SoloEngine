/**
 * @file FileExplorer.tsx
 * @description 文件资源管理器组件 - 项目文件浏览、编辑功能
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Tree, Input, Spin, Empty, Dropdown, Modal, App, Typography } from 'antd';
import {
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  FileTextOutlined,
  FileMarkdownOutlined,
  FileImageOutlined,
  FileZipOutlined,
  FilePdfOutlined,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { TreeDataNode, TreeProps } from 'antd';
import { useRunPanelStore } from './stores/runPanelStore';
import { runProjectApi, FileInfo } from '../../services/runProjectApi';
import type { FileSystemChange } from './types';
import { insertTreeNode, removeTreeNode, moveTreeNode } from './utils/treePatchUtils';
import ConfirmDialog from '../common/ConfirmDialog';

const { Text } = Typography;

interface FileExplorerProps {
  onFileSelect?: (file: FileInfo) => void;
  onFileEdit?: (file: FileInfo) => void;
  onActionsReady?: (actions: {
    refresh: () => void;
    applyIncrementalChanges: (changes: FileSystemChange[]) => void;
    openNewFileDialog: () => void;
    openNewFolderDialog: () => void;
    navigateToFile: (path: string) => Promise<void>;
  }) => void;
}

export interface FileTreeNode extends TreeDataNode {
  file?: FileInfo;
  children?: FileTreeNode[];
}

function collectKeys(nodes: FileTreeNode[]): string[] {
  const result: string[] = [];
  for (const n of nodes) {
    result.push(n.key as string);
    if (n.children) result.push(...collectKeys(n.children));
  }
  return result;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onFileEdit, onActionsReady }) => {
  const { message } = App.useApp();
  const {
    currentProject,
    files,
    currentPath,
    projectLoading: loading,
    listFiles,
    agenticFlowId,
  } = useRunPanelStore();

  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const selectedKeysRef = useRef<React.Key[]>([]);
  const lastClickedKeyRef = useRef<string | null>(null);
  const menuActionPendingRef = useRef(false);
  const flatKeysRef = useRef<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const expandedKeysRef = useRef<string[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
  const loadedKeysRef = useRef<string[]>([]);
  const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
  const [loadingKeys, setLoadingKeys] = useState<string[]>([]);
  const [newFileDialogVisible, setNewFileDialogVisible] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFolderDialogVisible, setNewFolderDialogVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<FileInfo[]>([]);
  const treeRef = useRef<any>(null);

  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentId = currentProject?.id || null;
    if (prevProjectIdRef.current !== null && prevProjectIdRef.current !== currentId) {
      setTreeData([]);
      setExpandedKeys([]);
      setLoadedKeys([]);
      setSelectedKeys([]);
      setLoadingKeys([]);
    }
    prevProjectIdRef.current = currentId;
  }, [currentProject?.id]);

  const handleRefresh = useCallback(async () => {
    setLoadedKeys([]);
    setExpandedKeys([]);
    setTreeData([]);
    await listFiles('');
  }, [listFiles]);

  const applyIncrementalChanges = useCallback(
    (changes: FileSystemChange[]) => {
      // 直接刷新根目录，让 buildTreeData 创建格式正确的节点（图标、右键菜单等）
      listFiles('');
    },
    [listFiles],
  );

  const openNewFileDialog = useCallback(() => {
    setNewFileDialogVisible(true);
  }, []);

  const openNewFolderDialog = useCallback(() => {
    setNewFolderDialogVisible(true);
  }, []);

  const onActionsReadyRef = useRef(onActionsReady);
  onActionsReadyRef.current = onActionsReady;

  useEffect(() => {
    if (onActionsReadyRef.current) {
      onActionsReadyRef.current({
        refresh: handleRefresh,
        applyIncrementalChanges,
        openNewFileDialog,
        openNewFolderDialog,
        navigateToFile,
      });
    }
  }, [handleRefresh, applyIncrementalChanges, openNewFileDialog, openNewFolderDialog]);

  useEffect(() => {
    if (currentProject) {
      listFiles('');
    }
  }, [currentProject]);

  useEffect(() => {
    if (files.length > 0 && loadedKeys.length === 0) {
      setTreeData(buildTreeData(files));
    }
  }, [files, loadedKeys.length]);

  const resolveFilesByKeys = useCallback((keys: React.Key[]): FileInfo[] => {
    return keys.map(k => findFileByPath(treeData, k as string)).filter(Boolean) as FileInfo[];
  }, [treeData]);

  const getFileIcon = (file: FileInfo, isOpen?: boolean) => {
    if (file.is_dir) {
      return isOpen ? 
        <FolderOpenOutlined style={{ color: '#f59e0b' }} /> : 
        <FolderOutlined style={{ color: '#f59e0b' }} />;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const buildTreeData = (fileList: FileInfo[]): FileTreeNode[] => {
    const folders = fileList.filter(f => f.is_dir);
    const files = fileList.filter(f => !f.is_dir);

    const sortByName = (a: FileInfo, b: FileInfo) => a.name.localeCompare(b.name);
    
    const sortedFolders = folders.sort(sortByName);
    const sortedFiles = files.sort(sortByName);

    return [...sortedFolders, ...sortedFiles].map(file => ({
      key: file.path,
      title: (
        <Dropdown
          menu={{ items: [
            {
              key: 'edit',
              icon: <EditOutlined />,
              label: '编辑',
              disabled: file.is_dir,
              onClick: () => {
                menuActionPendingRef.current = true;
                setTimeout(() => { menuActionPendingRef.current = false; }, 100);
                if (!file.is_dir && onFileEdit) onFileEdit(file);
              },
            },
            {
              key: 'copy',
              icon: <CopyOutlined />,
              label: '复制路径',
              onClick: () => {
                menuActionPendingRef.current = true;
                setTimeout(() => { menuActionPendingRef.current = false; }, 100);
                navigator.clipboard.writeText(file.path);
                message.success('路径已复制');
              },
            },
            { type: 'divider' },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: '删除',
              danger: true,
              onClick: () => {
                menuActionPendingRef.current = true;
                setTimeout(() => { menuActionPendingRef.current = false; }, 100);
                const currentSelection = selectedKeysRef.current;
                if (currentSelection.includes(file.path)) {
                  setDeleteTargets(resolveFilesByKeys(currentSelection));
                } else {
                  setDeleteTargets([file]);
                }
              },
            },
          ] }}
          trigger={['contextMenu']}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '1px 0',
            }}
          >
            {getFileIcon(file)}
            <Text style={{ 
              fontSize: 13, 
              flex: 1, 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
            }}>
              {file.name}
            </Text>
            {!file.is_dir && (
              <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                {formatFileSize(file.size)}
              </Text>
            )}
          </div>
        </Dropdown>
      ),
      isLeaf: !file.is_dir,
      file: file,
      children: file.is_dir ? [] : undefined,
    }));
  };

  selectedKeysRef.current = selectedKeys;
  expandedKeysRef.current = expandedKeys;
  loadedKeysRef.current = loadedKeys;
  flatKeysRef.current = collectKeys(treeData);

  const handleSelect: TreeProps['onSelect'] = (keys, info) => {
    if (menuActionPendingRef.current) return;
    const ev = info.nativeEvent as MouseEvent | undefined;
    const clickedKey = info.node.key as string;
    if (!ev) return;

    if (ev.ctrlKey || ev.metaKey) {
      setSelectedKeys(prev => {
        const next = prev.includes(clickedKey)
          ? prev.filter(k => k !== clickedKey)
          : [...prev, clickedKey];
        return next;
      });
      lastClickedKeyRef.current = clickedKey;
      return;
    }

    if (ev.shiftKey && lastClickedKeyRef.current) {
      const flatKeys = flatKeysRef.current;
      const a = flatKeys.indexOf(lastClickedKeyRef.current);
      const b = flatKeys.indexOf(clickedKey);
      if (a !== -1 && b !== -1) {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        setSelectedKeys(flatKeys.slice(start, end + 1));
      }
      return;
    }

    setSelectedKeys([clickedKey]);
    lastClickedKeyRef.current = clickedKey;

    const file = findFileByPath(treeData, clickedKey);
    if (file) {
      if (file.is_dir) {
        setExpandedKeys(prev =>
          prev.includes(clickedKey) ? prev.filter(k => k !== clickedKey) : [...prev, clickedKey]
        );
      } else if (onFileSelect) {
        onFileSelect(file);
      }
    }
  };

  const handleRightClick: TreeProps['onRightClick'] = ({ node }) => {
    const key = node.key as string;
    if (!selectedKeysRef.current.includes(key)) {
      setSelectedKeys([key]);
      lastClickedKeyRef.current = key;
    }
  };

  const findFileByPath = (nodes: FileTreeNode[], path: string): FileInfo | null => {
    for (const node of nodes) {
      if (node.key === path && node.file) {
        return node.file;
      }
      if (node.children) {
        const found = findFileByPath(node.children, path);
        if (found) return found;
      }
    }
    return null;
  };

  const handleExpand: TreeProps['onExpand'] = (expandedKeys) => {
    setExpandedKeys(expandedKeys as string[]);
  };

  const handleLoadData: TreeProps['loadData'] = async ({ key, children }) => {
    if (children && children.length > 0) return;
    if (loadingKeys.includes(key as string)) return;

    setLoadingKeys(prev => [...prev, key as string]);
    
    try {
      const response = await runProjectApi.listFiles(key as string, '*', agenticFlowId);
      if (response.code === 200 && response.data.files.length > 0) {
        const newChildren = buildTreeData(response.data.files);
        
        setTreeData(prev => updateTreeChildren(prev, key as string, newChildren));
        setLoadedKeys(prev => [...prev, key as string]);
      } else {
        setLoadedKeys(prev => [...prev, key as string]);
      }
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setLoadingKeys(prev => prev.filter(k => k !== key));
    }
  };

  const updateTreeChildren = (
    nodes: FileTreeNode[], 
    targetKey: string, 
    newChildren: FileTreeNode[]
  ): FileTreeNode[] => {
    return nodes.map(node => {
      if (node.key === targetKey) {
        return { ...node, children: newChildren };
      }
      if (node.children) {
        return { 
          ...node, 
          children: updateTreeChildren(node.children, targetKey, newChildren) 
        };
      }
      return node;
    });
  };

  const handleDoubleClick = (file: FileInfo) => {
    if (!file.is_dir && onFileEdit) {
      onFileEdit(file);
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) {
      message.warning('请输入文件名');
      return;
    }

    setActionLoading(true);
    try {
      const filePath = currentPath ? `${currentPath}/${newFileName}` : newFileName;
      await runProjectApi.writeFile(filePath, '', 'utf-8', 'write', agenticFlowId);
      message.success('文件创建成功');
      setNewFileDialogVisible(false);
      setNewFileName('');
    } catch (error: any) {
      message.error('创建文件失败: ' + (error.response?.data?.detail || error.message));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      message.warning('请输入文件夹名称');
      return;
    }

    setActionLoading(true);
    try {
      const folderPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;
      await runProjectApi.createDirectory(folderPath, agenticFlowId);
      message.success('文件夹创建成功');
      setNewFolderDialogVisible(false);
      setNewFolderName('');
    } catch (error: any) {
      message.error('创建文件夹失败: ' + (error.response?.data?.detail || error.message));
    } finally {
      setActionLoading(false);
    }
  };

  const navigateToFile = useCallback(async (filePath: string) => {
    const parts = filePath.replace(/\\/g, '/').split('/');
    let accumulated = '';
    for (let i = 0; i < parts.length; i++) {
      accumulated = i === 0 ? parts[i] : `${accumulated}/${parts[i]}`;
      const parentPath = i === 0 ? '' : parts.slice(0, i).join('/');
      if (parentPath !== '' && !loadedKeysRef.current.includes(parentPath) && parentPath !== accumulated) {
        try {
          const response = await runProjectApi.listFiles(parentPath, '*', agenticFlowId);
          if (response.code === 200 && response.data.files.length > 0) {
            const newChildren = buildTreeData(response.data.files);
            setTreeData(prev => updateTreeChildren(prev, parentPath, newChildren));
            setLoadedKeys(prev =>
              prev.includes(parentPath) ? prev : [...prev, parentPath]
            );
          }
        } catch {
        }
      }
      if (i < parts.length - 1) {
        if (!expandedKeysRef.current.includes(accumulated)) {
          setExpandedKeys(prev => [...prev, accumulated]);
          expandedKeysRef.current = [...expandedKeysRef.current, accumulated];
        }
      }
    }
    setSelectedKeys([filePath]);
    lastClickedKeyRef.current = filePath;
    setTimeout(() => {
      treeRef.current?.scrollTo({ key: filePath, align: 'top' });
    }, 100);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    const targets = deleteTargets;
    if (targets.length === 0) return;
    const isBatch = targets.length > 1;
    try {
      for (const file of targets) {
        await runProjectApi.deleteFile(file.path, agenticFlowId);
        setTreeData(prev => removeTreeNode(prev, file.path));
      }
      message.success(isBatch ? `已删除 ${targets.length} 个文件` : '删除成功');
      setSelectedKeys(prev => prev.filter(k => !targets.some(t => t.path === k)));
      setDeleteTargets([]);
    } catch (error: any) {
      message.error('删除失败: ' + (error.response?.data?.detail || error.message));
      throw error;
    }
  }, [deleteTargets, message]);

  const isBatchDelete = deleteTargets.length > 1;
  const deleteTarget = deleteTargets.length === 1 ? deleteTargets[0] : null;

  if (!currentProject) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Empty
          description="请先选择项目"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .custom-file-tree .ant-tree-switcher {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 20px !important;
          min-width: 20px !important;
          line-height: 20px !important;
        }
        .custom-file-tree .ant-tree-node-content-wrapper {
          display: flex !important;
          align-items: center !important;
          min-height: 22px !important;
          line-height: 22px !important;
        }
        .custom-file-tree .ant-tree-title {
          display: flex !important;
          align-items: center !important;
          width: 100% !important;
        }
        .custom-file-tree .ant-tree-switcher-line-icon {
          vertical-align: middle !important;
        }
      `}</style>
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 4px' }}>
        {loading && treeData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : treeData.length === 0 ? (
          <Empty
            description="空文件夹"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ padding: 24 }}
          />
        ) : (
          <Tree
            ref={treeRef}
            multiple
            showLine={{ showLeafIcon: false }}
            blockNode
            selectedKeys={selectedKeys}
            expandedKeys={expandedKeys}
            loadedKeys={loadedKeys}
            treeData={treeData}
            onSelect={handleSelect}
            onExpand={handleExpand}
            onRightClick={handleRightClick}
            loadData={handleLoadData}
            onDoubleClick={(e, node) => {
              const file = findFileByPath(treeData, node.key as string);
              if (file) handleDoubleClick(file);
            }}
            style={{ 
              background: 'transparent', 
              fontSize: 13,
            }}
            className="custom-file-tree"
          />
        )}
      </div>

      <Modal
        title="新建文件"
        open={newFileDialogVisible}
        onOk={handleCreateFile}
        onCancel={() => {
          setNewFileDialogVisible(false);
          setNewFileName('');
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={actionLoading}
      >
        <Input
          placeholder="输入文件名"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          onPressEnter={handleCreateFile}
          autoFocus
        />
      </Modal>

      <Modal
        title="新建文件夹"
        open={newFolderDialogVisible}
        onOk={handleCreateFolder}
        onCancel={() => {
          setNewFolderDialogVisible(false);
          setNewFolderName('');
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={actionLoading}
      >
        <Input
          placeholder="输入文件夹名称"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onPressEnter={handleCreateFolder}
          autoFocus
        />
      </Modal>

      <ConfirmDialog
        open={deleteTargets.length > 0}
        title="确认删除"
        content={
          isBatchDelete
            ? (() => {
                const MAX_NAMES = 5;
                const visibleNames = deleteTargets.slice(0, MAX_NAMES).map(f => f.name);
                const overflow = deleteTargets.length - MAX_NAMES;
                return (
                  <div>
                    <p className="sc-confirm-dialog-text">确定要删除选中的 {deleteTargets.length} 个文件吗？</p>
                    <div style={{ marginTop: 8 }}>
                      {visibleNames.map(name => (
                        <p key={name} className="sc-confirm-dialog-text" style={{ margin: 0 }}>{name}</p>
                      ))}
                      {overflow > 0 && (
                        <p className="sc-confirm-dialog-text" style={{ margin: 0 }}>...</p>
                      )}
                    </div>
                    <p className="sc-confirm-dialog-text" style={{ marginTop: 6 }}>您可以从回收站还原这些文件。</p>
                  </div>
                );
              })()
            : deleteTarget
              ? (
                <div>
                  <p className="sc-confirm-dialog-text">确定要删除 "{deleteTarget.name}" 吗？{deleteTarget.is_dir ? '文件夹内的所有内容也将被删除。' : ''}</p>
                  <p className="sc-confirm-dialog-text" style={{ marginTop: 6 }}>您可以从回收站还原此文件。</p>
                </div>
              )
              : ''
        }
        okText="确认"
        cancelText="取消"
        danger
        onOk={handleDeleteConfirm}
        onCancel={() => setDeleteTargets([])}
      />
    </div>
  );
};

export default FileExplorer;
