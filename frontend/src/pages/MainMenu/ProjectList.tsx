import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Space, Typography, Empty, Spin, Modal, Input, message, Tag } from 'antd';
import { PlusOutlined, FolderOutlined, DeleteOutlined, EditOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { localStorageService } from '../../services/localStorage';

const { Title, Text } = Typography;

interface Project {
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
}

const ProjectList: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const loadProjects = async () => {
    setLoading(true);
    try {
      const flows = await localStorageService.listFlows();
      const projectList: Project[] = flows.map((flow: any) => ({
        name: flow.name || flow.project_name,
        createdAt: flow.created_at || new Date().toISOString(),
        updatedAt: flow.updated_at || new Date().toISOString(),
        nodeCount: flow.nodes?.length || 0,
        edgeCount: flow.edges?.length || 0,
      }));
      setProjects(projectList);
    } catch (error) {
      console.error('Failed to load projects:', error);
      message.error('加载项目列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      message.error('请输入项目名称');
      return;
    }

    try {
      await localStorageService.saveFlowToFile(newProjectName, [], []);
      message.success('项目创建成功');
      setCreateModalVisible(false);
      setNewProjectName('');
      navigate(`/editor/${newProjectName}`);
    } catch (error) {
      message.error('创建项目失败');
    }
  };

  const handleOpenProject = (projectName: string) => {
    navigate(`/editor/${projectName}`);
  };

  /**
   * 处理删除项目
   * 
   * @description 显示确认对话框并删除指定项目
   * @param {string} projectName - 项目名称
   */
  const handleDeleteProject = (projectName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除项目 "${projectName}" 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await localStorageService.deleteFlow(projectName);
          message.success('项目已删除');
          loadProjects();
        } catch (error) {
          message.error('删除项目失败');
        }
      },
    });
  };

  /**
   * 格式化日期
   * 
   * @description 将日期字符串格式化为本地化显示
   * @param {string} dateString - ISO日期字符串
   * @returns {string} 格式化后的日期字符串
   */
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '未知';
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <Space>
          <FolderOutlined style={{ fontSize: 24, color: 'var(--primary-100)' }} />
          <Title level={3} style={{ margin: 0 }}>
            项目管理
          </Title>
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          新建项目
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <Spin size="large" />
        </div>
      ) : projects.length === 0 ? (
        <Empty
          description="暂无项目"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
            创建第一个项目
          </Button>
        </Empty>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '16px',
        }}>
          {projects.map((project) => (
            <Card
              key={project.name}
              hoverable
              style={{
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
              }}
              bodyStyle={{ padding: '20px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <FolderOutlined style={{ fontSize: 20, color: 'var(--primary-100)' }} />
                    <Text strong style={{ fontSize: 16 }}>{project.name}</Text>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <Tag color="blue">{project.nodeCount} 节点</Tag>
                    <Tag color="green">{project.edgeCount} 连接</Tag>
                  </div>
                  
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px',
                    color: 'var(--text-200)',
                    fontSize: '12px'
                  }}>
                    <ClockCircleOutlined />
                    <span>更新于 {formatDate(project.updatedAt)}</span>
                  </div>
                </div>
                
                <Space direction="vertical" size="small">
                  <Button
                    type="primary"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleOpenProject(project.name)}
                  >
                    打开
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteProject(project.name)}
                  >
                    删除
                  </Button>
                </Space>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="新建项目"
        open={createModalVisible}
        onOk={handleCreateProject}
        onCancel={() => {
          setCreateModalVisible(false);
          setNewProjectName('');
        }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="请输入项目名称"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onPressEnter={handleCreateProject}
          autoFocus
        />
      </Modal>
    </div>
  );
};

export default ProjectList;
