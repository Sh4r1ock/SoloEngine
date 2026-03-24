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
import { PlayCircleOutlined, CloseOutlined, DragOutlined, SaveOutlined, HomeOutlined } from '@ant-design/icons';
import Canvas from '../../components/Canvas/Canvas';
import PropertyPanel from '../../components/PropertyEditor/PropertyEditor';
import Preview from '../../components/Preview/Preview';
import { useCanvasStore } from '../../store/canvasStore';
import { projectApi } from '../../services/api';
import { localStorageService } from '../../services/localStorage';
import { agenticFlowApi } from '../../services/agenticFlowApi';

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
    setPreviewOpen,
  } = useCanvasStore();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [panelWidth, setPanelWidth] = useState(480);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initialWidth = Math.floor(window.innerWidth * 0.25);
    setPanelWidth(initialWidth);
  }, []);

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
          const flow = await agenticFlowApi.getFlow(projectId);
          if (flow) {
            const canvasData = flow.canvas_data || { nodes: [], edges: [] };
            useCanvasStore.getState().setNodes(canvasData.nodes || []);
            useCanvasStore.getState().setEdges(canvasData.edges || []);
            setCurrentProject({ 
              id: projectId, 
              name: flow.name,
              canvas: canvasData
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
   * @description 保存当前画布数据到服务器
   * @returns {Promise<void>}
   */
  const handleSave = async () => {
    const { nodes, edges } = useCanvasStore.getState();
    const agenticFlowId = projectId || currentProject?.id;
    if (!agenticFlowId) {
      message.error('无法保存：缺少项目ID');
      return;
    }
    try {
      await agenticFlowApi.saveCanvas(agenticFlowId, { nodes, edges });
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
    const minWidth = Math.max(280, Math.floor(window.innerWidth * 0.2));
    const maxWidth = Math.floor(window.innerWidth * 0.5);

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
   * 运行项目
   * 
   * @description 在新标签页打开运行面板
   */
  const handleRun = () => {
    const id = currentProject?.id || projectId;
    const url = id ? `/run/${id}` : '/run';
    window.open(url, '_blank');
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
        background: 'var(--sidebar-bg)',
        borderBottom: '1px solid var(--sidebar-hover)',
        padding: '0 24px',
        height: '56px',
      }}>
        <div 
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
          onClick={handleGoHome}
        >
          <div style={{
            width: '32px',
            height: '32px',
            background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
            borderRadius: 'var(--radius-base)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '14px',
            fontWeight: 'bold',
          }}>
            SE
          </div>
          
          <div style={{ 
            color: '#fff', 
            fontSize: '16px', 
            fontWeight: 600,
          }}>
            SoloEngine
          </div>
          
          {currentProject && (
            <div style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginLeft: '4px',
            }}>
              <span style={{ 
                width: '6px', 
                height: '6px', 
                backgroundColor: 'var(--accent-100)',
                borderRadius: '50%',
              }} />
              <span style={{
                color: 'rgba(255, 255, 255, 0.7)', 
                fontSize: '14px',
              }}>{currentProject.name}</span>
            </div>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Button
            icon={<HomeOutlined />}
            onClick={handleGoHome}
            style={{
              height: '36px',
              borderColor: 'rgba(255, 255, 255, 0.3)',
              color: 'rgba(255, 255, 255, 0.85)',
              background: 'rgba(255, 255, 255, 0.1)',
            }}
          >
            主菜单
          </Button>
          <Button
            icon={<SaveOutlined />}
            onClick={handleSave}
            style={{
              height: '36px',
              borderColor: 'var(--primary-200)',
              color: '#fff',
              background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
            }}
          >
            保存
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleRun}
            style={{
              background: 'var(--success)',
              borderColor: 'var(--success)',
              height: '36px',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(76, 175, 80, 0.3)'
            }}
          >
            运行
          </Button>
        </div>
      </Header>

      <Layout style={{ height: 'calc(100vh - 56px)' }}>
        <Content style={{ background: 'var(--bg-secondary)' }}>
          <Canvas />
        </Content>

        {selectedNode && (
          <Sider
            width={panelWidth}
            style={{
              background: 'var(--bg-100)',
              borderLeft: '1px solid var(--border-color-light)',
              boxShadow: 'var(--shadow-lg)',
            }}
            trigger={null}
            collapsible={false}
          >
            <div style={{ 
              position: 'relative',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-100)',
            }}>
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={handleClosePropertyPanel}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  fontSize: 14,
                  padding: 8,
                  zIndex: 10,
                  color: 'var(--text-300)',
                  borderRadius: 'var(--radius-base)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color-lighter)',
                  transition: 'all var(--duration-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--error-color)';
                  e.currentTarget.style.background = '#fef2f2';
                  e.currentTarget.style.borderColor = '#fecaca';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-300)';
                  e.currentTarget.style.background = 'var(--bg-surface)';
                  e.currentTarget.style.borderColor = 'var(--border-color-lighter)';
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
                  if (!isPanelDragging) {
                    e.currentTarget.style.background = 'var(--primary-300)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isPanelDragging) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div style={{
                  width: 2,
                  height: 40,
                  background: isPanelDragging ? 'var(--primary-100)' : 'var(--border-color-lighter)',
                  borderRadius: 2,
                  transition: 'background 0.2s',
                }} />
              </div>
              
              <div style={{ 
                flex: 1, 
                overflowY: 'auto', 
                padding: '20px 20px 24px',
                paddingTop: '20px',
              }} className="custom-scrollbar">
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
    </Layout>
  );
};

export default EditorPage;
