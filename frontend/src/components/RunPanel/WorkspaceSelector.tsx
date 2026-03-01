import React, { useEffect, useState } from 'react';
import { Modal, List, Typography, Space, message, Spin, Button, Breadcrumb, Input, Tooltip } from 'antd';
import {
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  LeftOutlined,
  HomeOutlined,
  ReloadOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { workspaceApi, WorkspaceRoot, BrowseItem } from '../../services/workspaceApi';
import { useDebugProjectStore } from '../../store/debugProjectStore';

const { Text } = Typography;

interface WorkspaceSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}

const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({ visible, onClose, onSelect }) => {
  const [loading, setLoading] = useState(false);
  const [roots, setRoots] = useState<WorkspaceRoot[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [manualPath, setManualPath] = useState('');
  const { currentProject } = useDebugProjectStore();

  useEffect(() => {
    if (visible) {
      loadRoots();
    }
  }, [visible]);

  const loadRoots = async () => {
    setLoading(true);
    try {
      const response = await workspaceApi.getWorkspaceRoots();
      if (response.code === 200) {
        const data = response.data as { roots: WorkspaceRoot[]; system: string };
        setRoots(data.roots);
        setCurrentPath('');
        setItems([]);
        setSelectedPath('');
      }
    } catch (error) {
      message.error('加载工作区根目录失败');
    } finally {
      setLoading(false);
    }
  };

  const browseDirectory = async (path: string) => {
    setLoading(true);
    try {
      const response = await workspaceApi.browseDirectory(path);
      if (response.code === 200) {
        if ('items' in response.data) {
          setItems(response.data.items);
          setCurrentPath(response.data.current_path);
          setParentPath(response.data.parent_path);
        } else {
          setRoots(response.data.roots);
          setCurrentPath('');
          setItems([]);
        }
      }
    } catch (error) {
      message.error('浏览目录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleItemDoubleClick = (item: BrowseItem) => {
    if (item.is_dir) {
      browseDirectory(item.path);
    }
  };

  const handleItemClick = (item: BrowseItem) => {
    if (item.is_dir) {
      setSelectedPath(item.path);
    }
  };

  const handleGoBack = () => {
    if (parentPath) {
      browseDirectory(parentPath);
    } else {
      loadRoots();
    }
  };

  const handleConfirm = () => {
    if (selectedPath) {
      onSelect(selectedPath);
      onClose();
    } else if (manualPath.trim()) {
      onSelect(manualPath.trim());
      onClose();
    } else {
      message.warning('请选择一个文件夹');
    }
  };

  const handleManualPathSubmit = () => {
    if (manualPath.trim()) {
      browseDirectory(manualPath.trim());
    }
  };

  const pathParts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : [];

  return (
    <Modal
      title={
        <Space>
          <FolderOpenOutlined />
          <span>选择工作区</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      onOk={handleConfirm}
      okText="确认选择"
      cancelText="取消"
      width={700}
      okButtonProps={{ disabled: !selectedPath && !manualPath.trim() }}
    >
      <Spin spinning={loading}>
        <div style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="手动输入路径..."
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onPressEnter={handleManualPathSubmit}
            />
            <Button type="primary" onClick={handleManualPathSubmit}>
              跳转
            </Button>
          </Space.Compact>
        </div>

        {currentPath ? (
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Button 
                icon={<LeftOutlined />} 
                onClick={handleGoBack}
                size="small"
              >
                返回上级
              </Button>
              <Button 
                icon={<HomeOutlined />} 
                onClick={loadRoots}
                size="small"
              >
                根目录
              </Button>
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => browseDirectory(currentPath)}
                size="small"
              >
                刷新
              </Button>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Breadcrumb>
                <Breadcrumb.Item>
                  <FolderOutlined />
                </Breadcrumb.Item>
                {pathParts.map((part, index) => (
                  <Breadcrumb.Item key={index}>
                    {part}
                  </Breadcrumb.Item>
                ))}
              </Breadcrumb>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">选择一个根目录开始浏览，或手动输入路径</Text>
          </div>
        )}

        <div style={{ 
          border: '1px solid var(--border-color-light)', 
          borderRadius: 8, 
          maxHeight: 400, 
          overflow: 'auto' 
        }}>
          {!currentPath && roots.length > 0 ? (
            <List
              dataSource={roots}
              renderItem={(root) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    padding: '12px 16px',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-200)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  onClick={() => browseDirectory(root.path)}
                >
                  <List.Item.Meta
                    avatar={<FolderOutlined style={{ fontSize: 20, color: 'var(--primary-100)' }} />}
                    title={root.name}
                    description={
                      <Tooltip title={root.path}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {root.path}
                        </Text>
                      </Tooltip>
                    }
                  />
                </List.Item>
              )}
            />
          ) : items.length > 0 ? (
            <List
              dataSource={items}
              renderItem={(item) => (
                <List.Item
                  style={{
                    cursor: item.is_dir ? 'pointer' : 'default',
                    padding: '12px 16px',
                    transition: 'background 0.2s',
                    background: selectedPath === item.path ? 'var(--primary-300)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (item.is_dir && selectedPath !== item.path) {
                      e.currentTarget.style.background = 'var(--bg-200)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedPath !== item.path) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                  onClick={() => item.is_dir && handleItemClick(item)}
                  onDoubleClick={() => item.is_dir && handleItemDoubleClick(item)}
                >
                  <List.Item.Meta
                    avatar={
                      item.is_dir ? (
                        selectedPath === item.path ? (
                          <CheckOutlined style={{ fontSize: 20, color: 'var(--success)' }} />
                        ) : (
                          <FolderOutlined style={{ fontSize: 20, color: 'var(--primary-100)' }} />
                        )
                      ) : (
                        <FileOutlined style={{ fontSize: 20, color: 'var(--text-300)' }} />
                      )
                    }
                    title={
                      <Space>
                        {item.name}
                        {item.is_dir && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            文件夹
                          </Text>
                        )}
                      </Space>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.is_dir ? '' : `${(item.size / 1024).toFixed(1)} KB`}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-300)' }}>
              <FolderOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <div>当前目录为空</div>
            </div>
          )}
        </div>

        {selectedPath && (
          <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-200)', borderRadius: 8 }}>
            <Space>
              <CheckOutlined style={{ color: 'var(--success)' }} />
              <Text>已选择: </Text>
              <Text strong>{selectedPath}</Text>
            </Space>
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default WorkspaceSelector;
