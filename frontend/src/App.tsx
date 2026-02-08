import React, { useState, useRef, useEffect } from 'react';
import { Layout, Button, Modal, Input, message, Typography } from 'antd';
import { PlusOutlined, PlayCircleOutlined, CloseOutlined, DragOutlined } from '@ant-design/icons';
import Canvas from './components/Canvas/Canvas';
import PropertyPanel from './components/PropertyEditor/PropertyEditor';
import Preview from './components/Preview/Preview';
import SettingsModal from './components/Settings/SettingsModal';
import { useCanvasStore } from './store/canvasStore';
import { projectApi } from './services/api';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

const App: React.FC = () => {
  const { 
    currentProject, 
    setCurrentProject, 
    selectedNode,
    setSelectedNode,
    isPreviewOpen, 
    isSettingsOpen,
    setPreviewOpen,
    setSettingsOpen
  } = useCanvasStore();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [panelWidth, setPanelWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      message.error('请输入项目名称');
      return;
    }

    try {
      const project = await projectApi.createProject(projectName);
      setCurrentProject(project);
      setIsModalVisible(false);
      setProjectName('');
      message.success('项目创建成功');
    } catch (error) {
      message.error('项目创建失败');
    }
  };

  const handleClosePropertyPanel = () => {
    setSelectedNode(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const newWidth = window.innerWidth - e.clientX;
    const minWidth = 280;
    const maxWidth = 600;

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setPanelWidth(newWidth);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        background: '#ffffff',
        borderBottom: '1px solid #f1f5f9',
        padding: '0 24px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      }}>
        <div style={{ color: '#2563eb', fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>
          SoloEngine
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {currentProject && (
            <span style={{ color: '#1f2937', fontSize: 14 }}>
              {currentProject.name}
            </span>
          )}
          <Button 
            type="primary" 
            icon={<PlayCircleOutlined />} 
            onClick={() => setPreviewOpen(true)}
            style={{
              background: '#10b981',
              borderColor: '#10b981',
              height: 36,
              fontWeight: 600,
            }}
          >
            运行
          </Button>
          <Button 
            icon={<PlusOutlined />} 
            onClick={() => setIsModalVisible(true)}
            style={{ height: 36 }}
          >
            新建项目
          </Button>
        </div>
      </Header>

      <Layout style={{ height: 'calc(100vh - 64px)' }}>
        <Content style={{ background: '#f8f9fa' }}>
          <Canvas />
        </Content>

        {selectedNode && (
          <Sider
            width={panelWidth}
            style={{
              background: '#ffffff',
              borderLeft: '1px solid #f1f5f9',
              boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.06)',
            }}
            trigger={null}
          >
            <div style={{ 
              position: 'relative',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={handleClosePropertyPanel}
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  fontSize: 14,
                  padding: 4,
                  zIndex: 10,
                }}
              />
              <div
                ref={dragHandleRef}
                onMouseDown={handleMouseDown}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 4,
                  cursor: 'col-resize',
                  background: '#f1f5f9',
                  transition: isDragging ? 'none' : 'background 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <DragOutlined 
                  style={{ 
                    fontSize: 12, 
                    color: '#9ca3af',
                    transform: 'rotate(90deg)',
                  }} 
                />
              </div>
              <div style={{ 
                flex: 1, 
                overflowY: 'auto', 
                padding: '16px 24px 24px' 
              }}>
                <PropertyPanel />
              </div>
            </div>
          </Sider>
        )}
      </Layout>

      <Modal
        title="新建项目"
        open={isModalVisible}
        onOk={handleCreateProject}
        onCancel={() => setIsModalVisible(false)}
      >
        <Input
          placeholder="请输入项目名称"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </Modal>

      <Preview 
        visible={isPreviewOpen} 
        onClose={() => setPreviewOpen(false)} 
      />
      
      <SettingsModal 
        visible={isSettingsOpen} 
        onClose={() => setSettingsOpen(false)} 
      />
    </Layout>
  );
};

export default App;
