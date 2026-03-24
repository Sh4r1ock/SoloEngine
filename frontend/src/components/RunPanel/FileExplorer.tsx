/**
 * @file FileExplorer.tsx
 * @description 文件资源管理器组件 - 项目文件浏览、编辑功能
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tree, Input, Button, Space, Spin, Empty, Dropdown, Modal, message, Typography, Tooltip } from 'antd';
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
  ReloadOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { MenuProps, TreeDataNode, TreeProps } from 'antd';
import { useRunProjectStore } from '../../store/runProjectStore';
import { runProjectApi, FileInfo } from '../../services/runProjectApi';

const { Text } = Typography;

interface FileExplorerProps {
  onFileSelect?: (file: FileInfo) => void;
  onFileEdit?: (file: FileInfo) => void;
  onActionsReady?: (actions: { refresh: () => void; openNewFileDialog: () => void; openNewFolderDialog: () => void }) => void;
}

interface FileTreeNode extends TreeDataNode {
  file?: FileInfo;
  children?: FileTreeNode[];
}

const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onFileEdit, onActionsReady }) => {
  const {
    currentProject,
    files,
    currentPath,
    loading,
    listFiles,
    setCurrentPath,
  } = useRunProjectStore();

  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
  const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
  const [loadingKeys, setLoadingKeys] = useState<string[]>([]);
  const [contextMenuFile, setContextMenuFile] = useState<FileInfo | null>(null);
  const [newFileDialogVisible, setNewFileDialogVisible] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFolderDialogVisible, setNewFolderDialogVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const handleRefresh = useCallback(() => {
    setLoadedKeys([]);
    setExpandedKeys([]);
    setTreeData([]);
    listFiles('');
  }, [listFiles]);

  const openNewFileDialog = useCallback(() => {
    setNewFileDialogVisible(true);
  }, []);

  const openNewFolderDialog = useCallback(() => {
    setNewFolderDialogVisible(true);
  }, []);

  useEffect(() => {
    if (onActionsReady) {
      onActionsReady({
        refresh: handleRefresh,
        openNewFileDialog,
        openNewFolderDialog,
      });
    }
  }, [onActionsReady, handleRefresh, openNewFileDialog, openNewFolderDialog]);

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
          menu={{ items: contextMenuItems }}
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
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenuFile(file);
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

  const handleSelect = (selectedKeys: React.Key[], info: any) => {
    if (selectedKeys.length > 0) {
      const path = selectedKeys[0] as string;
      const file = findFileByPath(treeData, path);
      if (file) {
        setSelectedFile(file);
        if (file.is_dir) {
          if (expandedKeys.includes(path)) {
            setExpandedKeys(expandedKeys.filter(key => key !== path));
          } else {
            setExpandedKeys([...expandedKeys, path]);
          }
        } else if (onFileSelect) {
          onFileSelect(file);
        }
      }
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

  const handleExpand: TreeProps['onExpand'] = (expandedKeys, info) => {
    setExpandedKeys(expandedKeys as string[]);
  };

  const handleLoadData: TreeProps['loadData'] = async ({ key, children }) => {
    if (children && children.length > 0) return;
    if (loadingKeys.includes(key as string)) return;

    setLoadingKeys(prev => [...prev, key as string]);
    
    try {
      const response = await runProjectApi.listFiles(key as string, '*');
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
      await runProjectApi.writeFile(filePath, '');
      message.success('文件创建成功');
      setNewFileDialogVisible(false);
      setNewFileName('');
      handleRefresh();
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
      await runProjectApi.createDirectory(folderPath);
      message.success('文件夹创建成功');
      setNewFolderDialogVisible(false);
      setNewFolderName('');
      handleRefresh();
    } catch (error: any) {
      message.error('创建文件夹失败: ' + (error.response?.data?.detail || error.message));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (file: FileInfo) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 "${file.name}" 吗？${file.is_dir ? '文件夹内的所有内容也将被删除。' : ''}`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await runProjectApi.deleteFile(file.path);
          message.success('删除成功');
          handleRefresh();
          if (selectedFile?.path === file.path) {
            setSelectedFile(null);
          }
        } catch (error: any) {
          message.error('删除失败: ' + (error.response?.data?.detail || error.message));
        }
      },
    });
  };

  const contextMenuItems: MenuProps['items'] = contextMenuFile
    ? [
        {
          key: 'edit',
          icon: <EditOutlined />,
          label: '编辑',
          disabled: contextMenuFile.is_dir,
          onClick: () => {
            if (!contextMenuFile.is_dir && onFileEdit) {
              onFileEdit(contextMenuFile);
            }
          },
        },
        {
          key: 'copy',
          icon: <CopyOutlined />,
          label: '复制路径',
          onClick: () => {
            navigator.clipboard.writeText(contextMenuFile.path);
            message.success('路径已复制');
          },
        },
        { type: 'divider' },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: '删除',
          danger: true,
          onClick: () => handleDelete(contextMenuFile),
        },
      ]
    : [];

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
            showLine={{ showLeafIcon: false }}
            blockNode
            selectedKeys={selectedFile ? [selectedFile.path] : []}
            expandedKeys={expandedKeys}
            loadedKeys={loadedKeys}
            treeData={treeData}
            onSelect={handleSelect}
            onExpand={handleExpand}
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
    </div>
  );
};

export default FileExplorer;
