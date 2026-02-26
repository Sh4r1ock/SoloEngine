import React, { useEffect, useState, useRef } from 'react';
import { Button, Dropdown, Modal, List, Typography, Space, message, Spin, Empty, Tooltip } from 'antd';
import {
  FolderOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  ReloadOutlined,
  SettingOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useDebugProjectStore } from '../../store/debugProjectStore';
import { debugProjectApi, RecentProjectInfo } from '../../services/debugProjectApi';

const { Text } = Typography;

interface ProjectSelectorProps {
  onProjectChange?: (project: { id: string; name: string; folder_path: string } | null) => void;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({ onProjectChange }) => {
  const {
    currentProject,
    recentProjects,
    loading,
    selectFolder,
    loadCurrentProject,
    loadRecentProjects,
    switchProject,
  } = useDebugProjectStore();

  const [recentModalVisible, setRecentModalVisible] = useState(false);
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCurrentProject();
    loadRecentProjects();
  }, []);

  useEffect(() => {
    if (onProjectChange) {
      onProjectChange(currentProject);
    }
  }, [currentProject, onProjectChange]);

  const handleSelectFolder = async () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFolderChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const folderPath = (file as any).path || (file as any).webkitRelativePath;
      
      if (folderPath) {
        const pathParts = folderPath.split('/');
        const actualFolderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : folderPath;
        
        const success = await selectFolder(actualFolderPath);
        if (success) {
          message.success(`已选择项目: ${actualFolderPath.split('/').pop() || actualFolderPath}`);
        }
      }
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSelectFromRecent = async (project: RecentProjectInfo) => {
    setSwitchingProjectId(project.project_id);
    try {
      const success = await switchProject(project.project_id);
      if (success) {
        message.success(`已切换到项目: ${project.project_name}`);
        setRecentModalVisible(false);
      }
    } finally {
      setSwitchingProjectId(null);
    }
  };

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'select',
      label: (
        <span onClick={handleSelectFolder}>
          <FolderOutlined style={{ marginRight: 8 }} />
          项目选择
        </span>
      ),
    },
    {
      key: 'recent',
      label: (
        <span onClick={() => setRecentModalVisible(true)}>
          <HistoryOutlined style={{ marginRight: 8 }} />
          最近项目
        </span>
      ),
    },
  ];

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    
    return date.toLocaleDateString('zh-CN');
  };

  const truncatePath = (path: string, maxLength: number = 40) => {
    if (path.length <= maxLength) return path;
    const parts = path.split('/');
    if (parts.length <= 2) return '...' + path.slice(-(maxLength - 3));
    return '.../' + parts.slice(-2).join('/');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={handleFolderChange}
      />
      
      {currentProject ? (
        <Dropdown
          menu={{ items: dropdownItems }}
          trigger={['click']}
          placement="bottomLeft"
        >
          <Button
            type="text"
            icon={<FolderOpenOutlined style={{ color: 'var(--primary-100)' }} />}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              height: 36,
              borderRadius: 6,
              background: 'var(--bg-200)',
              border: '1px solid var(--bg-300)',
            }}
          >
            <Text style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentProject.name}
            </Text>
          </Button>
        </Dropdown>
      ) : (
        <Button
          type="primary"
          icon={<FolderOutlined />}
          onClick={handleSelectFolder}
          loading={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          项目选择
        </Button>
      )}

      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>最近项目</span>
          </Space>
        }
        open={recentModalVisible}
        onCancel={() => setRecentModalVisible(false)}
        footer={null}
        width={500}
      >
        <Spin spinning={loading}>
          {recentProjects.length === 0 ? (
            <Empty
              description="暂无最近访问的项目"
              style={{ padding: '40px 0' }}
            />
          ) : (
            <List
              dataSource={recentProjects}
              renderItem={(project) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    padding: '12px 16px',
                    borderRadius: 8,
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-200)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  onClick={() => handleSelectFromRecent(project)}
                >
                  <List.Item.Meta
                    avatar={
                      switchingProjectId === project.project_id ? (
                        <Spin size="small" />
                      ) : currentProject?.id === project.project_id ? (
                        <CheckOutlined style={{ color: 'var(--success)', fontSize: 18 }} />
                      ) : (
                        <FolderOutlined style={{ fontSize: 18, color: 'var(--text-200)' }} />
                      )
                    }
                    title={
                      <Space>
                        <Text strong>{project.project_name}</Text>
                        {currentProject?.id === project.project_id && (
                          <Text type="success" style={{ fontSize: 12 }}>
                            当前
                          </Text>
                        )}
                      </Space>
                    }
                    description={
                      <Tooltip title={project.folder_path}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {truncatePath(project.folder_path)}
                        </Text>
                      </Tooltip>
                    }
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatTime(project.accessed_at)}
                  </Text>
                </List.Item>
              )}
              style={{ maxHeight: 400, overflow: 'auto' }}
            />
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default ProjectSelector;
