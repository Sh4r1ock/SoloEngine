/**
 * @file EditorPage.tsx
 * @description 编辑器主页面 - 工作流编辑器核心页面
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 集成画布编辑、节点面板、属性编辑器、工具栏等核心编辑功能
 * - 支持工作流可视化编辑
 * - 支持节点拖拽和连线
 * - 支持属性配置和工具操作
 * 
 * 使用场景：
 * - 用户创建或编辑工作流项目时使用
 * - 需要配置节点属性时使用
 * 
 * 注意事项：
 * - 支持Ctrl+Z撤销和Ctrl+Y重做快捷键
 * - 属性面板宽度可通过拖拽调整
 */
import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Button, Modal, Input, message } from 'antd';
import { PlayCircleOutlined, CloseOutlined, DragOutlined, SaveOutlined, SettingOutlined, BugOutlined, HomeOutlined } from '@ant-design/icons';
import Canvas from '../../components/Canvas/Canvas';
import PropertyPanel from '../../components/PropertyEditor/PropertyEditor';
import Preview from '../../components/Preview/Preview';
import SettingsModal from '../../components/Settings/SettingsModal';
import { useCanvasStore } from '../../store/canvasStore';
import { projectApi } from '../../services/api';
import { localStorageService } from '../../services/localStorage';

const { Header, Content, Sider } = Layout;

/**
 * 编辑器主页面组件
 * 
 * @description 工作流编辑器主页面，集成画布编辑、节点面板、属性编辑器、工具栏等核心编辑功能
 * @returns {JSX.Element} 编辑器主页面组件
 */
const EditorPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
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

  useEffect(() => {
    if (projectId) {
      /**
       * 加载项目数据
       * 
       * @description 从本地存储加载项目画布数据
       * @returns {Promise<void>}
       */
      const loadProject = async () => {
        try {
          const flowData = await localStorageService.loadFlowFromFile(projectId);
          if (flowData) {
            useCanvasStore.getState().setNodes(flowData.nodes || []);
            useCanvasStore.getState().setEdges(flowData.edges || []);
            setCurrentProject({ 
              id: projectId, 
              name: projectId,
              canvas: { nodes: flowData.nodes || [], edges: flowData.edges || [] }
            });
          }
        } catch (error) {
          console.error('Failed to load project:', error);
        }
      };
      loadProject();
    }
  }, [projectId, setCurrentProject]);

  /**
   * 处理创建项目
   * 
   * @description 创建新项目并导航到编辑器页面
   * @returns {Promise<void>}
   */
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
      navigate(`/editor/${project.id || projectName}`);
    } catch (error) {
      message.error('项目创建失败');
    }
  };

  /**
   * 处理保存项目
   * 
   * @description 保存当前画布数据到本地存储
   * @returns {Promise<void>}
   */
  const handleSave = async () => {
    const { nodes, edges } = useCanvasStore.getState();
    const defaultProjectName = projectId || currentProject?.name || 'default_flow';
    try {
      await localStorageService.saveFlowToFile(defaultProjectName, nodes, edges);
      message.success('保存成功');
    } catch (error) {
      message.error('保存失败');
    }
  };

  /**
   * 关闭属性面板
   * 
   * @description 取消选中节点并关闭属性编辑面板
   */
  const handleClosePropertyPanel = () => {
    setSelectedNode(null);
  };

  /**
   * 处理鼠标按下事件
   * 
   * @description 开始拖拽调整属性面板宽度
   * @param {React.MouseEvent} e - 鼠标事件对象
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsPanelDragging(true);
  };

  /**
   * 处理鼠标移动事件
   * 
   * @description 拖拽过程中调整属性面板宽度
   * @param {MouseEvent} e - 鼠标事件对象
   */
  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanelDragging) return;

    const newWidth = window.innerWidth - e.clientX;
    const minWidth = 280;
    const maxWidth = 600;

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setPanelWidth(newWidth);
    }
  };

  /**
   * 处理鼠标释放事件
   * 
   * @description 结束拖拽调整属性面板宽度
   */
  const handleMouseUp = () => {
    setIsPanelDragging(false);
  };

  /**
   * 返回主菜单
   * 
   * @description 导航到主菜单页面
   */
  const handleGoHome = () => {
    navigate('/mainmenu');
  };

  /**
   * 跳转到调试页面
   * 
   * @description 导航到调试页面进行工作流调试
   */
  const handleGoToDebug = () => {
    if (projectId) {
      navigate(`/debug/${projectId}`);
    } else {
      navigate('/debug');
    }
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
            boxShadow: '0 2px 8px rgba(63, 81, 181, 0.2)',
            cursor: 'pointer',
          }} onClick={handleGoHome}>
            SE
          </div>
          
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
          <Button
            icon={<HomeOutlined />}
            onClick={handleGoHome}
            style={{
              height: '36px',
              borderColor: 'var(--bg-400)',
              color: 'var(--text-100)'
            }}
          >
            主菜单
          </Button>
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
            icon={<SettingOutlined />}
            onClick={() => setSettingsOpen(true)}
            style={{
              height: '36px',
              borderColor: 'var(--bg-400)',
              color: 'var(--text-100)'
            }}
          >
            设置
          </Button>
          <Button
            icon={<BugOutlined />}
            onClick={handleGoToDebug}
            style={{
              height: '36px',
              borderColor: 'var(--accent-100)',
              color: 'var(--accent-100)'
            }}
          >
            调试
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleGoToDebug}
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
                  transition: isPanelDragging ? 'none' : 'background 0.2s',
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

export default EditorPage;
