import React, { useState, useRef, useEffect } from 'react';
import { Layout, Button, Modal, Input, message } from 'antd';
import { PlusOutlined, PlayCircleOutlined, CloseOutlined, DragOutlined, SaveOutlined } from '@ant-design/icons';
import Canvas from './components/Canvas/Canvas';
import PropertyPanel from './components/PropertyEditor/PropertyEditor';
import Preview from './components/Preview/Preview';
import SettingsModal from './components/Settings/SettingsModal';
import { useCanvasStore } from './store/canvasStore';
import { projectApi } from './services/api';
import { localStorageService } from './services/localStorage';

const { Header, Content, Sider } = Layout;

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
  const [isPanelDragging, setIsPanelDragging] = useState(false);
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

  const handleSave = async () => {
    const { nodes, edges } = useCanvasStore.getState();
    const defaultProjectName = 'default_flow';
    try {
      await localStorageService.saveFlowToFile(defaultProjectName, nodes, edges);
      message.success('保存成功');
    } catch (error) {
      message.error('保存失败');
    }
  };

  const handleClosePropertyPanel = () => {
    setSelectedNode(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsPanelDragging(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanelDragging) return;

    const newWidth = window.innerWidth - e.clientX;
    const minWidth = 280;
    const maxWidth = 600;

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setPanelWidth(newWidth);
    }
  };

  const handleMouseUp = () => {
    setIsPanelDragging(false);
  };

  useEffect(() => {
    if (isPanelDragging) {
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
  }, [isPanelDragging]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        useCanvasStore.getState().undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        useCanvasStore.getState().redo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        background: 'linear-gradient(135deg, var(--primary-50), var(--bg-200))',
        borderBottom: '1px solid var(--bg-300)',
        padding: '0 24px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.05)',
        height: '64px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* 品牌标识 - 类似配色demo中的avatar */}
          <div style={{
            width: '36px',
            height: '36px',
            background: 'linear-gradient(135deg, var(--primary-100), var(--accent-100))',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '16px',
            fontWeight: 'bold',
            boxShadow: '0 2px 8px rgba(63, 81, 181, 0.2)'
          }}>
            SE
          </div>
          
          {/* 品牌文字 */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ 
              color: 'var(--primary-100)', 
              fontSize: '18px', 
              fontWeight: 700,
              lineHeight: 1.2
            }}>
              SoloEngine
            </div>
            {currentProject && (
              <div style={{ 
                color: 'var(--text-200)', 
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span style={{ 
                  width: '6px', 
                  height: '6px', 
                  backgroundColor: 'var(--accent-100)',
                  borderRadius: '50%',
                  display: 'inline-block'
                }} />
                <span>{currentProject.name}</span>
              </div>
            )}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {currentProject && (
            <div style={{
              backgroundColor: 'var(--bg-100)',
              border: '1px solid var(--bg-300)',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '14px',
              color: 'var(--text-100)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
            }}>
              {currentProject.name}
            </div>
          )}
          <Button 
            icon={<SaveOutlined />} 
            onClick={handleSave}
            style={{ 
              height: '36px',
              borderColor: 'var(--primary-100)',
              color: 'var(--primary-100)'
            }}
          >
            保存
          </Button>
          <Button 
            type="primary" 
            icon={<PlayCircleOutlined />} 
            onClick={() => setPreviewOpen(true)}
            style={{
              background: 'var(--success)',
              borderColor: 'var(--success)',
              height: '36px',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(76, 175, 80, 0.2)'
            }}
          >
            运行
          </Button>
        </div>
      </Header>

      <Layout style={{ height: 'calc(100vh - 64px)' }}>
        <Content style={{ background: '#f5f5f5' }}>
          <Canvas />
        </Content>

        {selectedNode && (
          <Sider
            width={panelWidth}
            style={{
              background: '#FFFFFF',
              borderLeft: '1px solid #cccccc',
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
                  background: '#f5f5f5',
                  transition: isDragging ? 'none' : 'background 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <DragOutlined 
                  style={{ 
                    fontSize: 12, 
                    color: '#5c5c5c',
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
