/**
 * @file FileExplorer.tsx
 * @description 文件资源管理器组件 - 项目文件浏览、编辑功能
 * @author SoloEngine Team
 * @date 2026-02-23
 */
import React, { useState, useEffect } from 'react';
import { Tree, Input, Button, Space, Spin, Empty, Dropdown, Modal, message, Typography, Tooltip } from 'antd';
import {
  FolderOutlined,
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
import type { MenuProps, TreeDataNode } from 'antd';
import { useRunProjectStore } from '../../store/runProjectStore';
import { runProjectApi, FileInfo } from '../../services/runProjectApi';

const { Text } = Typography;

interface FileExplorerProps {
  onFileSelect?: (file: FileInfo) => void;
  onFileEdit?: (file: FileInfo) => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onFileEdit }) => {
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
  const [contextMenuFile, setContextMenuFile] = useState<FileInfo | null>(null);
  const [newFileDialogVisible, setNewFileDialogVisible] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFolderDialogVisible, setNewFolderDialogVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (currentProject) {
      listFiles('');
    }
  }, [currentProject]);

  const getFileIcon = (file: FileInfo) => {
    if (file.is_dir) {
      return <FolderOutlined style={{ color: '#f59e0b' }} />;
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

  const buildTreeData = (fileList: FileInfo[]): TreeDataNode[] => {
    const folders = fileList.filter(f => f.is_dir);
    const files = fileList.filter(f => !f.is_dir);

    const sortByName = (a: FileInfo, b: FileInfo) => a.name.localeCompare(b.name);
    
    const sortedFolders = folders.sort(sortByName);
    const sortedFiles = files.sort(sortByName);

    return [...sortedFolders, ...sortedFiles].map(file => ({
      key: file.path,
      title: (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            paddingRight: 8,
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenuFile(file);
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {getFileIcon(file)}
            <Text style={{ fontSize: 13 }}>{file.name}</Text>
          </span>
          {!file.is_dir && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatFileSize(file.size)}
            </Text>
          )}
        </div>
      ),
      icon: file.is_dir ? <FolderOutlined /> : <FileOutlined />,
      isLeaf: !file.is_dir,
      children: file.is_dir ? undefined : undefined,
    }));
  };

  const handleSelect = (selectedKeys: React.Key[], info: any) => {
    if (selectedKeys.length > 0) {
      const path = selectedKeys[0] as string;
      const file = files.find(f => f.path === path);
      if (file) {
        setSelectedFile(file);
        if (!file.is_dir && onFileSelect) {
          onFileSelect(file);
        }
      }
    }
  };

  const handleExpand = (expandedKeys: React.Key[]) => {
    setExpandedKeys(expandedKeys as string[]);
  };

  const handleDoubleClick = (file: FileInfo) => {
    if (!file.is_dir && onFileEdit) {
      onFileEdit(file);
    }
  };

  const handleRefresh = () => {
    listFiles(currentPath);
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
      listFiles(currentPath);
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
      listFiles(currentPath);
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
          listFiles(currentPath);
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
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
        }}
      >
        <Text strong style={{ fontSize: 13 }}>
          文件资源管理器
        </Text>
        <Space size={4}>
          <Tooltip title="新建文件">
            <Button
              type="text"
              size="small"
              icon={<FileAddOutlined />}
              onClick={() => setNewFileDialogVisible(true)}
            />
          </Tooltip>
          <Tooltip title="新建文件夹">
            <Button
              type="text"
              size="small"
              icon={<FolderAddOutlined />}
              onClick={() => setNewFolderDialogVisible(true)}
            />
          </Tooltip>
          <Tooltip title="刷新">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={loading}
            />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : files.length === 0 ? (
          <Empty
            description="空文件夹"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ padding: 24 }}
          />
        ) : (
          <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
            <div>
              <Tree
                showIcon
                blockNode
                selectedKeys={selectedFile ? [selectedFile.path] : []}
                expandedKeys={expandedKeys}
                treeData={buildTreeData(files)}
                onSelect={handleSelect}
                onExpand={handleExpand}
                onDoubleClick={(e, node) => {
                  const file = files.find(f => f.path === node.key);
                  if (file) handleDoubleClick(file);
                }}
                style={{ background: 'transparent' }}
              />
            </div>
          </Dropdown>
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
