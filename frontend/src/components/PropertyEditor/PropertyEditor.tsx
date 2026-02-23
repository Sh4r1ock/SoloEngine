/**
 * @file PropertyEditor.tsx
 * @description 属性编辑器组件 - 节点属性编辑核心组件
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 提供选中节点的属性编辑表单
 * - 编辑节点名称
 * - 配置节点参数
 * - 设置节点属性
 * - 节点测试功能
 * - 提示词模板库
 * - 变量插值预览
 * - LLM配置选择（支持用户配置的模型）
 * 
 * 使用场景：
 * - 在编辑器页面右侧属性面板中使用
 * - 编辑选中节点的各种属性配置
 * 
 * 重构说明：
 * - 模型配置改为使用用户在设置页面配置的LLM配置
 * - 支持选择已有的配置或使用默认配置
 * - 配置数据存储在节点数据的 llm_config_id 字段
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Form, Input, Select, Button, Typography, Divider, message, Tag, Modal, Spin, Card, Tabs, Tooltip, Popover, Empty, Alert } from 'antd';
import { ReloadOutlined, ToolOutlined, FolderOutlined, PlayCircleOutlined, BookOutlined, EyeOutlined, ThunderboltOutlined, SettingOutlined } from '@ant-design/icons';
import { useCanvasStore } from '../../store/canvasStore';
import { useMCPStore } from '../../store/mcpStore';
import { generateOrchestratorPrompt, generatePlannerPrompt, generateExecutorPrompt } from '../../utils/promptGenerator';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import { mcpApi, MCPTool } from '../../services/mcpApi';
import { debugApi } from '../../services/debugApi';
import { llmApi, LLMConfig } from '../../services/llmApi';
import LLMConfigSelector from '../Settings/LLMConfigSelector';

const { TextArea } = Input;
const { Text, Title } = Typography;

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'orchestrator' | 'planner' | 'executor' | 'general';
  template: string;
  variables: string[];
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'orchestrator-default',
    name: '协调者默认模板',
    description: '适用于协调者节点的基础模板',
    category: 'orchestrator',
    template: `你是一个工作流协调者，负责管理多个子Agent的协作。

可用Agent列表:
{available_agents}

用户输入: {user_input}

请分析用户需求，决定需要调用哪些Agent来完成任务。`,
    variables: ['available_agents', 'user_input']
  },
  {
    id: 'orchestrator-advanced',
    name: '协调者高级模板',
    description: '包含详细执行计划的高级模板',
    category: 'orchestrator',
    template: `你是一个高级工作流协调者，负责规划和管理复杂任务的执行。

可用Agent:
{available_agents}

执行历史:
{execution_history}

用户请求: {user_input}

请按以下格式输出:
1. 任务分析
2. 执行计划
3. 需要调用的Agent及顺序`,
    variables: ['available_agents', 'execution_history', 'user_input']
  },
  {
    id: 'planner-default',
    name: '规划者默认模板',
    description: '适用于规划者节点的基础模板',
    category: 'planner',
    template: `你是一个任务规划专家，负责将复杂任务分解为可执行的步骤。

可用执行者:
{available_executors}

当前任务: {user_input}

请制定详细的执行计划，包括每个步骤的具体操作和预期结果。`,
    variables: ['available_executors', 'user_input']
  },
  {
    id: 'executor-default',
    name: '执行者默认模板',
    description: '适用于执行者节点的基础模板',
    category: 'executor',
    template: `你是一个任务执行者，负责完成分配给你的具体任务。

你的能力:
{skills}

当前任务: {task}

请使用你的能力完成任务，并输出执行结果。`,
    variables: ['skills', 'task']
  },
  {
    id: 'executor-code',
    name: '代码执行者模板',
    description: '适用于代码生成和执行任务',
    category: 'executor',
    template: `你是一个代码专家，负责编写和执行代码任务。

任务描述: {task}

请按照以下步骤完成任务:
1. 分析需求
2. 设计解决方案
3. 编写代码
4. 测试验证

输出完整的代码和说明。`,
    variables: ['task']
  },
  {
    id: 'general-analysis',
    name: '通用分析模板',
    description: '适用于数据分析和总结任务',
    category: 'general',
    template: `请分析以下内容:

{content}

分析要求:
1. 总结关键信息
2. 识别主要模式
3. 提供洞察和建议`,
    variables: ['content']
  },
  {
    id: 'general-qa',
    name: '问答模板',
    description: '适用于问答场景',
    category: 'general',
    template: `请回答以下问题:

问题: {question}

背景信息: {context}

请提供准确、详细的回答。`,
    variables: ['question', 'context']
  }
];

const PropertyPanel: React.FC = () => {
  const { selectedNode, updateNode, nodes, edges, saveCanvas } = useCanvasStore();
  const { loadServers, servers } = useMCPStore();
  const [form] = Form.useForm();
  const [showAssistantPrompt, setShowAssistantPrompt] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  
  const [skillsPackages, setSkillsPackages] = useState<SkillsPackage[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);
  
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);
  
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  
  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfig | null>(null);
  const [hasNoConfig, setHasNoConfig] = useState(false);

  useEffect(() => {
    if (selectedNode) {
      form.setFieldsValue({
        name: selectedNode.data.name || '',
        desc: selectedNode.data.desc || '',
        agentType: selectedNode.data.agentType || 'executor',
        llm_config_id: selectedNode.data.llm_config_id || undefined,
        system_prompt: selectedNode.data.system_prompt || '',
        user_prompt: selectedNode.data.user_prompt || '',
        assistant_prompt: selectedNode.data.assistant_prompt || '',
        skills: selectedNode.data.skills || [],
        mcp_tools: selectedNode.data.mcp_tools || [],
      });
      
      if (selectedNode.data.llm_config_id) {
        llmApi.getConfig(selectedNode.data.llm_config_id).then(config => {
          setSelectedLLMConfig(config);
        }).catch(() => {
          setSelectedLLMConfig(null);
        });
      } else {
        setSelectedLLMConfig(null);
      }
    }
  }, [selectedNode, form]);

  const loadSkillsPackages = async () => {
    setLoadingSkills(true);
    try {
      const response = await skillsApi.getPackages();
      if (response.code === 200) {
        setSkillsPackages(response.data || []);
      }
    } catch (error) {
      console.error('Failed to load skills packages:', error);
    } finally {
      setLoadingSkills(false);
    }
  };

  const loadMCPTools = async () => {
    setLoadingTools(true);
    try {
      const response = await mcpApi.getServers();
      if (response.code === 200 && response.data) {
        const allTools: MCPTool[] = [];
        for (const server of response.data) {
          if (server.status === 'connected') {
            try {
              const toolsResponse = await mcpApi.getServerTools(server.id);
              if (toolsResponse.code === 200 && toolsResponse.data) {
                allTools.push(...toolsResponse.data);
              }
            } catch (e) {
              console.error(`Failed to get tools for server ${server.id}:`, e);
            }
          }
        }
        setMcpTools(allTools);
      }
    } catch (error) {
      console.error('Failed to load MCP tools:', error);
    } finally {
      setLoadingTools(false);
    }
  };

  useEffect(() => {
    loadSkillsPackages();
    loadMCPTools();
    loadServers();
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedNode) return;

    try {
      const values = form.getFieldsValue();

      updateNode(selectedNode.id, {
        name: values.name,
        desc: values.desc,
        agentType: values.agentType,
        system_prompt: values.system_prompt,
        user_prompt: values.user_prompt,
        assistant_prompt: values.assistant_prompt,
        llm_config_id: values.llm_config_id,
        model_config: selectedLLMConfig ? {
          config_id: selectedLLMConfig.id,
          config_name: selectedLLMConfig.name,
          provider: selectedLLMConfig.provider,
          model: selectedLLMConfig.model_name,
        } : undefined,
        skills: values.skills || [],
        mcp_tools: values.mcp_tools || [],
      });

      await saveCanvas();
    } catch (error) {
      message.error('保存失败，请重试');
    }
  }, [selectedNode, form, updateNode, saveCanvas, selectedLLMConfig]);

  const handleValuesChange = () => {
    if (saveTimeoutRef.current !== null) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 500) as unknown as number;
  };

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const getConnectedNodes = (nodeId: string, direction: 'upstream' | 'downstream') => {
    if (direction === 'upstream') {
      const sourceEdges = edges.filter(edge => edge.target === nodeId);
      return sourceEdges.map(edge => nodes.find(node => node.id === edge.source)).filter(Boolean);
    } else {
      const targetEdges = edges.filter(edge => edge.source === nodeId);
      return targetEdges.map(edge => nodes.find(node => node.id === edge.target)).filter(Boolean);
    }
  };

  const generateSmartPrompt = () => {
    if (!selectedNode) return;

    const agentType = selectedNode.data.agentType;
    
    if (agentType === 'orchestrator') {
      const plannerNodes = getConnectedNodes(selectedNode.id, 'downstream').filter(
        node => node?.data.agentType === 'planner'
      );
      const prompt = generateOrchestratorPrompt(selectedNode as any, plannerNodes as any);
      form.setFieldsValue({ system_prompt: prompt });
    } else if (agentType === 'planner') {
      const executorNodes = getConnectedNodes(selectedNode.id, 'downstream').filter(
        node => node?.data.agentType === 'executor'
      );
      const prompt = generatePlannerPrompt(selectedNode as any, executorNodes as any);
      form.setFieldsValue({ system_prompt: prompt });
    } else if (agentType === 'executor') {
      const prompt = generateExecutorPrompt(selectedNode as any);
      form.setFieldsValue({ system_prompt: prompt });
    }
  };

  const handleTestNode = async () => {
    if (!selectedNode || !testInput.trim()) {
      message.warning('请输入测试输入');
      return;
    }

    setTestLoading(true);
    setTestResult(null);

    try {
      const canvasData = {
        nodes: [selectedNode],
        edges: []
      };

      const result = await debugApi.executeNode(
        canvasData,
        selectedNode.id,
        testInput,
        {}
      );

      setTestResult(result);
      message.success('节点测试完成');
    } catch (error: any) {
      setTestResult({
        status: 'error',
        error: error.message || '测试执行失败'
      });
      message.error('节点测试失败');
    } finally {
      setTestLoading(false);
    }
  };

  const handleApplyTemplate = (template: PromptTemplate) => {
    form.setFieldsValue({ system_prompt: template.template });
    setTemplateModalVisible(false);
    message.success(`已应用模板: ${template.name}`);
  };

  const handleLLMConfigChange = (configId: string, config: LLMConfig | null) => {
    setSelectedLLMConfig(config);
    form.setFieldsValue({ llm_config_id: configId });
    handleValuesChange();
  };

  const getAvailableVariables = (): Record<string, string> => {
    const variables: Record<string, string> = {
      '{user_input}': '用户输入内容',
      '{execution_history}': '执行历史记录',
      '{current_plan}': '当前执行计划',
      '{timestamp}': '当前时间戳',
    };

    if (selectedNode) {
      if (selectedNode.data.agentType === 'orchestrator') {
        variables['{available_agents}'] = '可用Agent列表';
        const downstreamNodes = getConnectedNodes(selectedNode.id, 'downstream');
        if (downstreamNodes.length > 0) {
          variables['{downstream_agents}'] = downstreamNodes.map(n => n?.data.name).join(', ');
        }
      } else if (selectedNode.data.agentType === 'planner') {
        variables['{available_executors}'] = '可用执行者列表';
      } else if (selectedNode.data.agentType === 'executor') {
        variables['{skills}'] = '绑定的技能列表';
        variables['{task}'] = '当前任务';
      }
    }

    if (selectedNode?.data.skills?.length) {
      variables['{skills}'] = selectedNode.data.skills.join(', ');
    }

    return variables;
  };

  const interpolatePrompt = (prompt: string): string => {
    const variables = getAvailableVariables();
    let result = prompt;
    
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    return result;
  };

  const handlePreviewInterpolation = () => {
    const systemPrompt = form.getFieldValue('system_prompt');
    if (!systemPrompt) {
      message.warning('请先输入提示词');
      return;
    }
    
    const interpolated = interpolatePrompt(systemPrompt);
    setPreviewContent(interpolated);
    setPreviewVisible(true);
  };

  const getModelOptions = (provider: string) => {
    switch (provider) {
      case 'openai':
        return [
          { value: 'gpt-4o', label: 'GPT-4o' },
          { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
        ];
      case 'anthropic':
        return [
          { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
          { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
          { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
          { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
        ];
      case 'qwen':
        return [
          { value: 'qwen-max', label: '通义千问 Max' },
          { value: 'qwen-plus', label: '通义千问 Plus' },
          { value: 'qwen-turbo', label: '通义千问 Turbo' },
        ];
      case 'ollama':
        return [
          { value: 'llama3', label: 'Llama 3' },
          { value: 'llama2', label: 'Llama 2' },
          { value: 'mistral', label: 'Mistral' },
          { value: 'codellama', label: 'Code Llama' },
        ];
      default:
        return [];
    }
  };

  const getFilteredTemplates = () => {
    const agentType = selectedNode?.data.agentType;
    if (!agentType) return PROMPT_TEMPLATES.filter(t => t.category === 'general');
    
    return PROMPT_TEMPLATES.filter(t => 
      t.category === agentType || t.category === 'general'
    );
  };

  if (!selectedNode) {
    return (
      <div style={{ 
        textAlign: 'center', 
        color: '#5c5c5c', 
        marginTop: 100 
      }}>
        <Text>请选择一个节点以编辑其属性</Text>
      </div>
    );
  }

  return (
    <>
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
        <Form.Item label="节点名称" name="name" rules={[{ required: true, message: '请输入节点名称' }]}>
          <Input placeholder="请输入节点名称" />
        </Form.Item>

        <Form.Item label="节点简介" name="desc">
          <Input placeholder="请输入节点简介" />
        </Form.Item>

        <Form.Item label="Agent 类型" name="agentType" rules={[{ required: true, message: '请选择 Agent 类型' }]}>
          <Select>
            <Select.Option value="orchestrator">协调者</Select.Option>
            <Select.Option value="planner">规划者</Select.Option>
            <Select.Option value="executor">执行者</Select.Option>
          </Select>
        </Form.Item>

        <Divider>模型配置</Divider>

        <Form.Item 
          label="LLM配置" 
          name="llm_config_id"
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#999' }}>
                从设置页面配置的模型中选择
              </span>
              <Button 
                type="link" 
                size="small" 
                icon={<SettingOutlined />}
                onClick={() => window.open('/mainmenu/settings', '_blank')}
              >
                管理配置
              </Button>
            </div>
          }
        >
          <LLMConfigSelector
            onChange={handleLLMConfigChange}
            showAddButton={true}
          />
        </Form.Item>

        {selectedLLMConfig && (
          <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Tag color={
                selectedLLMConfig.provider === 'openai' ? 'blue' :
                selectedLLMConfig.provider === 'anthropic' ? 'orange' :
                selectedLLMConfig.provider === 'qwen' ? 'green' : 'purple'
              }>
                {selectedLLMConfig.provider}
              </Tag>
              <Tag>{selectedLLMConfig.model_name}</Tag>
              {selectedLLMConfig.is_default && (
                <Tag color="gold">默认</Tag>
              )}
              <span style={{ fontSize: 12, color: '#999' }}>
                温度: {selectedLLMConfig.temperature} | 
                最大Token: {selectedLLMConfig.max_tokens}
              </span>
            </div>
          </Card>
        )}

        <Divider>提示词配置</Divider>

        <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button 
            type="default" 
            size="small"
            onClick={generateSmartPrompt}
            icon={<ThunderboltOutlined />}
          >
            智能生成
          </Button>
          <Button 
            type="default" 
            size="small"
            onClick={() => setTemplateModalVisible(true)}
            icon={<BookOutlined />}
          >
            模板库
          </Button>
          <Popover
            content={
              <div style={{ maxWidth: 300 }}>
                <Text strong>可用变量:</Text>
                <div style={{ marginTop: 8 }}>
                  {Object.entries(getAvailableVariables()).map(([key, value]) => (
                    <div key={key} style={{ marginBottom: 4 }}>
                      <Tag>{key}</Tag>
                      <Text type="secondary">{value}</Text>
                    </div>
                  ))}
                </div>
              </div>
            }
            title="变量说明"
            trigger="click"
          >
            <Button type="default" size="small">
              变量说明
            </Button>
          </Popover>
          <Button 
            type="default" 
            size="small"
            onClick={handlePreviewInterpolation}
            icon={<EyeOutlined />}
          >
            预览插值
          </Button>
        </div>

        <Form.Item
          label="System Prompt"
          name="system_prompt"
          extra="支持变量插值，如 {available_agents}"
        >
          <TextArea rows={4} placeholder="请输入系统提示词" />
        </Form.Item>

        <Form.Item
          label="User Prompt"
          name="user_prompt"
          extra="支持变量插值，如 {user_input}"
        >
          <TextArea rows={3} placeholder="请输入用户提示词" />
        </Form.Item>

        {showAssistantPrompt && (
          <Form.Item
            label="Assistant Prompt"
            name="assistant_prompt"
            extra="支持变量插值，如 {execution_history}"
          >
            <TextArea rows={3} placeholder="请输入助手提示词" />
          </Form.Item>
        )}

        <Button 
          type="link" 
          size="small" 
          onClick={() => setShowAssistantPrompt(!showAssistantPrompt)}
          style={{ marginBottom: 16 }}
        >
          {showAssistantPrompt ? '隐藏' : '显示'} Assistant Prompt
        </Button>

        <Divider>
          <PlayCircleOutlined style={{ marginRight: 8 }} />
          节点测试
        </Divider>

        <Button 
          type="primary" 
          onClick={() => setTestModalVisible(true)}
          icon={<PlayCircleOutlined />}
          style={{ marginBottom: 16 }}
        >
          测试节点
        </Button>

        <Divider>
          <FolderOutlined style={{ marginRight: 8 }} />
          Skills 包绑定
        </Divider>

        <Form.Item 
          label="绑定的 Skills 包" 
          name="skills"
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>从主菜单管理 Skills 包</span>
              <Button 
                type="link" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={loadSkillsPackages}
                loading={loadingSkills}
              >
                刷新
              </Button>
            </div>
          }
        >
          <Select 
            mode="multiple" 
            placeholder={loadingSkills ? "加载中..." : "请选择 Skills 包"}
            loading={loadingSkills}
            optionLabelProp="label"
          >
            {skillsPackages.map(pkg => (
              <Select.Option 
                key={pkg.name} 
                value={pkg.name}
                label={pkg.name}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span>{pkg.name}</span>
                  {pkg.metadata?.description && (
                    <span style={{ fontSize: 12, color: '#999' }}>
                      {pkg.metadata.description.substring(0, 50)}...
                    </span>
                  )}
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Divider>
          <ToolOutlined style={{ marginRight: 8 }} />
          MCP 工具绑定
        </Divider>

        <Form.Item 
          label="绑定的 MCP 工具" 
          name="mcp_tools"
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>从主菜单管理 MCP 服务器</span>
              <Button 
                type="link" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={loadMCPTools}
                loading={loadingTools}
              >
                刷新
              </Button>
            </div>
          }
        >
          <Select 
            mode="multiple" 
            placeholder={loadingTools ? "加载中..." : "请选择 MCP 工具"}
            loading={loadingTools}
            optionLabelProp="label"
          >
            {mcpTools.map(tool => (
              <Select.Option 
                key={`${tool.server_id}:${tool.name}`} 
                value={`${tool.server_id}:${tool.name}`}
                label={tool.name}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{tool.name}</span>
                    <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>
                      {servers.find(s => s.id === tool.server_id)?.name || '未知服务器'}
                    </Tag>
                  </div>
                  {tool.description && (
                    <span style={{ fontSize: 12, color: '#999' }}>
                      {tool.description.substring(0, 50)}...
                    </span>
                  )}
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>

      <Modal
        title="节点测试"
        open={testModalVisible}
        onCancel={() => {
          setTestModalVisible(false);
          setTestResult(null);
          setTestInput('');
        }}
        footer={[
          <Button key="cancel" onClick={() => setTestModalVisible(false)}>
            关闭
          </Button>,
          <Button 
            key="test" 
            type="primary" 
            onClick={handleTestNode}
            loading={testLoading}
          >
            执行测试
          </Button>,
        ]}
        width={700}
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong>测试输入:</Text>
          <TextArea
            rows={3}
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="请输入测试内容..."
            style={{ marginTop: 8 }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong>节点配置:</Text>
          <Card size="small" style={{ marginTop: 8, background: '#f5f5f5' }}>
            <div><Text type="secondary">名称:</Text> {selectedNode?.data.name}</div>
            <div><Text type="secondary">类型:</Text> {selectedNode?.data.agentType}</div>
            <div>
              <Text type="secondary">模型:</Text>{' '}
              {selectedLLMConfig ? (
                <span>
                  {selectedLLMConfig.name} ({selectedLLMConfig.provider}/{selectedLLMConfig.model_name})
                </span>
              ) : (
                <span style={{ color: '#ff4d4f' }}>未配置</span>
              )}
            </div>
          </Card>
        </div>

        {testResult && (
          <div>
            <Text strong>测试结果:</Text>
            <Card 
              size="small" 
              style={{ 
                marginTop: 8, 
                background: testResult.status === 'error' ? '#fff2f0' : '#f6ffed',
                maxHeight: 300,
                overflow: 'auto'
              }}
            >
              {testResult.status === 'error' ? (
                <Text type="danger">{testResult.error}</Text>
              ) : (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {typeof testResult.output === 'string' 
                    ? testResult.output 
                    : JSON.stringify(testResult, null, 2)}
                </pre>
              )}
            </Card>
          </div>
        )}
      </Modal>

      <Modal
        title="提示词模板库"
        open={templateModalVisible}
        onCancel={() => setTemplateModalVisible(false)}
        footer={null}
        width={700}
      >
        <Tabs
          items={[
            {
              key: 'current',
              label: '当前类型模板',
              children: (
                <div style={{ display: 'grid', gap: 12 }}>
                  {getFilteredTemplates().map(template => (
                    <Card
                      key={template.id}
                      size="small"
                      hoverable
                      onClick={() => handleApplyTemplate(template)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <Text strong>{template.name}</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {template.description}
                          </Text>
                          <div style={{ marginTop: 4 }}>
                            {template.variables.map(v => (
                              <Tag key={v} style={{ fontSize: 10 }}>{`{${v}}`}</Tag>
                            ))}
                          </div>
                        </div>
                        <Button type="link">应用</Button>
                      </div>
                    </Card>
                  ))}
                </div>
              ),
            },
            {
              key: 'all',
              label: '全部模板',
              children: (
                <div style={{ display: 'grid', gap: 12 }}>
                  {PROMPT_TEMPLATES.map(template => (
                    <Card
                      key={template.id}
                      size="small"
                      hoverable
                      onClick={() => handleApplyTemplate(template)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <Text strong>{template.name}</Text>
                          <Tag style={{ marginLeft: 8 }} color={
                            template.category === 'orchestrator' ? 'blue' :
                            template.category === 'planner' ? 'green' :
                            template.category === 'executor' ? 'orange' : 'default'
                          }>
                            {template.category}
                          </Tag>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {template.description}
                          </Text>
                        </div>
                        <Button type="link">应用</Button>
                      </div>
                    </Card>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="变量插值预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewVisible(false)}>
            关闭
          </Button>,
        ]}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong>原始提示词:</Text>
          <Card size="small" style={{ marginTop: 8, background: '#f5f5f5', maxHeight: 150, overflow: 'auto' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {form.getFieldValue('system_prompt')}
            </pre>
          </Card>
        </div>
        
        <div>
          <Text strong>插值后预览:</Text>
          <Card size="small" style={{ marginTop: 8, background: '#e6f7ff', maxHeight: 200, overflow: 'auto' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {previewContent}
            </pre>
          </Card>
        </div>
      </Modal>
    </>
  );
};

export default PropertyPanel;
