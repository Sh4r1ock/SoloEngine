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
import { Form, Input, InputNumber, Select, Button, Typography, Divider, message, Tag, Modal, Spin, Card, Tabs, Tooltip, Popover, Empty, Alert, Switch } from 'antd';
import { ReloadOutlined, ToolOutlined, FolderOutlined, BookOutlined, EyeOutlined, ThunderboltOutlined, SettingOutlined, DatabaseOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { useCanvasStore } from '../../store/canvasStore';
import { useMCPStore } from '../../store/mcpStore';
import { useRunStore } from '../../store/runStore';
import { generateOrchestratorPrompt, generatePlannerPrompt, generateExecutorPrompt } from '../../utils/promptGenerator';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import { mcpApi, MCPTool } from '../../services/mcpApi';
import { runApi } from '../../services/runApi';
import { llmApi, LLMConfig } from '../../services/llmApi';
import { toolsApi, ToolInfo, AgentPreset } from '../../services/toolsApi';
import { getPresets } from '../../stores/presetsStore';
import LLMConfigSelector from '../Settings/LLMConfigSelector';

const { TextArea } = Input;
const { Text, Title } = Typography;

const SOLOAGENT_TOOLS = [
  { name: 'Read', description: '读取文件内容' },
  { name: 'Write', description: '写入文件内容' },
  { name: 'DeleteFile', description: '删除文件' },
  { name: 'LS', description: '列出目录内容' },
  { name: 'Grep', description: '搜索文件内容' },
  { name: 'Glob', description: '模式匹配文件' },
  { name: 'SearchCodebase', description: '搜索代码库' },
  { name: 'RunCommand', description: '运行系统命令' },
  { name: 'CheckCommandStatus', description: '检查命令状态' },
  { name: 'StopCommand', description: '停止命令执行' },
  { name: 'GetDiagnostics', description: '获取诊断信息' },
  { name: 'WebFetch', description: '获取网页内容' },
  { name: 'WebSearch', description: '网络搜索' },
  { name: 'Skill', description: '调用技能' },
  { name: 'Task', description: '调用子Agent任务' },
  { name: 'TodoWrite', description: '管理待办事项' },
  { name: 'AskUserQuestion', description: '询问用户问题' },
  { name: 'OpenPreview', description: '打开预览' },
];

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
  const { projectId } = useParams<{ projectId: string }>();
  const { currentSessionId } = useRunStore();
  
  const [showAssistantPrompt, setShowAssistantPrompt] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  
  const [skillsPackages, setSkillsPackages] = useState<SkillsPackage[]>([]);
  const [allSkillsPackages, setAllSkillsPackages] = useState<SkillsPackage[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [allMcpTools, setAllMcpTools] = useState<MCPTool[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);
  const [localTools, setLocalTools] = useState<ToolInfo[]>([]);
  const [loadingLocalTools, setLoadingLocalTools] = useState(false);
  
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  
  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfig | null>(null);
  const selectedLLMConfigRef = useRef<LLMConfig | null>(null);
  const [hasNoConfig, setHasNoConfig] = useState(false);

  useEffect(() => {
    selectedLLMConfigRef.current = selectedLLMConfig;
  }, [selectedLLMConfig]);

  useEffect(() => {
    if (selectedNode) {
      const nodeModelConfig = selectedNode.data.model_config || {};
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
        tools: selectedNode.data.tools || [],
        memory: selectedNode.data.memory !== undefined ? selectedNode.data.memory : true,
        temperature: nodeModelConfig.temperature ?? 0.7,
        max_tokens: nodeModelConfig.max_tokens ?? 4096,
        frequency_penalty: nodeModelConfig.frequency_penalty ?? 0.5,
        presence_penalty: nodeModelConfig.presence_penalty ?? 0.5,
      });
      
      if (selectedNode.data.llm_config_id) {
        llmApi.getConfig(selectedNode.data.llm_config_id).then(config => {
          setSelectedLLMConfig(config);
          selectedLLMConfigRef.current = config;
        }).catch((error) => {
          console.warn('Failed to load LLM config:', error);
          setSelectedLLMConfig(null);
          selectedLLMConfigRef.current = null;
        });
      } else if (!selectedNode.data.model_config?.config_id) {
        llmApi.getDefaultConfig().then(config => {
          if (config) {
            setSelectedLLMConfig(config);
            selectedLLMConfigRef.current = config;
            form.setFieldsValue({ llm_config_id: config.id });
            updateNode(selectedNode.id, {
              llm_config_id: config.id,
              model_config: {
                config_id: config.id,
                config_name: config.name,
                provider: config.provider,
                model: config.model_name,
              },
            });
          } else {
            setSelectedLLMConfig(null);
            selectedLLMConfigRef.current = null;
          }
        }).catch((error) => {
          console.warn('Failed to load default LLM config:', error);
          setSelectedLLMConfig(null);
          selectedLLMConfigRef.current = null;
        });
      } else if (selectedNode.data.model_config) {
        const mc = selectedNode.data.model_config;
        setSelectedLLMConfig({
          id: mc.config_id || '',
          name: mc.config_name || '',
          provider: mc.provider,
          model_name: mc.model,
          temperature: mc.temperature ?? 0.7,
          max_tokens: mc.max_tokens ?? 4096,
          top_p: 1.0,
          frequency_penalty: mc.frequency_penalty ?? 0.5,
          presence_penalty: mc.presence_penalty ?? 0.5,
          timeout: 60,
          extra_params: {},
          is_default: false,
          is_active: true,
          version: 1,
          user_id: '',
        } as LLMConfig);
        selectedLLMConfigRef.current = null;
      }
    }
  }, [selectedNode, form, updateNode]);

  const loadSkillsPackages = async () => {
    setLoadingSkills(true);
    try {
      const response = await skillsApi.getPackages();
      if (response.code === 200) {
        const allPackages = response.data || [];
        setAllSkillsPackages(allPackages);
        setSkillsPackages(allPackages.filter(pkg => pkg.is_active));
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
        const enabledTools: MCPTool[] = [];
        
        for (const server of response.data) {
          const isEnabled = server.is_enabled ?? server.enabled;
          if (server.status === 'connected') {
            try {
              const toolsResponse = await mcpApi.getServerTools(server.id);
              if (toolsResponse.code === 200 && toolsResponse.data) {
                const serverTools = toolsResponse.data;
                allTools.push(...serverTools);
                if (isEnabled) {
                  enabledTools.push(...serverTools);
                }
              }
            } catch (e) {
              console.error(`Failed to get tools for server ${server.id}:`, e);
            }
          }
        }
        setAllMcpTools(allTools);
        setMcpTools(enabledTools);
      }
    } catch (error) {
      console.error('Failed to load MCP tools:', error);
    } finally {
      setLoadingTools(false);
    }
  };

  const loadLocalTools = async () => {
    setLoadingLocalTools(true);
    try {
      const response = await toolsApi.getTools();
      if (response.code === 200) {
        setLocalTools(response.data || []);
      }
    } catch (error) {
      console.error('Failed to load local tools:', error);
    } finally {
      setLoadingLocalTools(false);
    }
  };

  useEffect(() => {
    loadSkillsPackages();
    loadMCPTools();
    loadLocalTools();
    loadServers();
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedNode) return;

    try {
      const values = form.getFieldsValue();
      const currentConfig = selectedLLMConfigRef.current;

      updateNode(selectedNode.id, {
        name: values.name,
        desc: values.desc,
        agentType: values.agentType,
        system_prompt: values.system_prompt,
        user_prompt: values.user_prompt,
        assistant_prompt: values.assistant_prompt,
        llm_config_id: values.llm_config_id,
        model_config: currentConfig ? {
          config_id: currentConfig.id,
          config_name: currentConfig.name,
          provider: currentConfig.provider,
          model: currentConfig.model_name,
          temperature: values.temperature,
          max_tokens: values.max_tokens,
          frequency_penalty: values.frequency_penalty,
          presence_penalty: values.presence_penalty,
        } : undefined,
        skills: values.skills || [],
        mcp_tools: values.mcp_tools || [],
        tools: values.tools || [],
        memory: values.memory,
      });
    } catch (error) {
      message.error('保存失败，请重试');
    }
  }, [selectedNode, form, updateNode]);

  const handleValuesChange = () => {
    if (saveTimeoutRef.current !== null) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 500) as unknown as number;
  };

  const getPresetIcon = (iconName: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      'TeamOutlined': <TeamOutlined />,
      'UserOutlined': <UserOutlined />,
      'ToolOutlined': <ToolOutlined />,
      'SettingOutlined': <SettingOutlined />,
    };
    return iconMap[iconName] || <SettingOutlined />;
  };

  const handlePresetChange = (presetId: string) => {
    const preset = getPresets().find(p => p.id === presetId);
    if (preset) {
      form.setFieldsValue({
        agentType: preset.id,
        tools: preset.tools,
        skills: preset.skills,
        mcp_tools: preset.mcp_tools,
        system_prompt: preset.system_prompt,
      });
      updateNode(selectedNode.id, {
        color: preset.color || '#3F51B5',
      });
      handleValuesChange();
    }
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

  const handleApplyTemplate = (template: PromptTemplate) => {
    form.setFieldsValue({ system_prompt: template.template });
    setTemplateModalVisible(false);
    message.success(`已应用模板: ${template.name}`);
  };

  const handleLLMConfigChange = (configId: string, config: LLMConfig | null) => {
    setSelectedLLMConfig(config);
    selectedLLMConfigRef.current = config;
    form.setFieldsValue({ llm_config_id: configId });

    if (config) {
      form.setFieldsValue({
        temperature: config.temperature ?? 0.7,
        max_tokens: config.max_tokens ?? 4096,
        frequency_penalty: config.frequency_penalty ?? 0.5,
        presence_penalty: config.presence_penalty ?? 0.5,
      });
    }

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
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange} className="property-panel-form">
        <Form.Item 
          label="节点名称" 
          name="name" 
          rules={[{ required: true, message: '请输入节点名称' }]}
          className="property-panel-form-item"
        >
          <Input placeholder="请输入节点名称" />
        </Form.Item>

        <Form.Item 
          label="节点简介" 
          name="desc"
          className="property-panel-form-item"
        >
          <Input placeholder="请输入节点简介" />
        </Form.Item>

        <Form.Item 
          label="Agent 类型" 
          name="agentType" 
          rules={[{ required: true, message: '请选择 Agent 类型' }]}
          className="property-panel-form-item"
        >
          <Select
            placeholder="请选择 Agent 类型"
            onChange={handlePresetChange}
            optionLabelProp="label"
          >
            {getPresets().map(preset => (
              <Select.Option 
                key={preset.id} 
                value={preset.id}
                label={preset.name}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: preset.color || '#3F51B5' }}>
                    {getPresetIcon(preset.icon)}
                  </span>
                  <span>{preset.name}</span>
                  <span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>
                    {preset.description}
                  </span>
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item 
          name="memory"
          valuePropName="checked"
          className="property-panel-form-item"
        >
          <div className="property-panel-switch-wrapper">
            <div className="property-panel-switch-label">
              <span className="property-panel-switch-title">启用记忆</span>
              <span className="property-panel-switch-desc">
                启用后，对话历史将保存到数据库，支持多轮对话上下文
              </span>
            </div>
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </div>
        </Form.Item>

        <Divider className="property-panel-divider">模型配置</Divider>

        <Form.Item 
          label="LLM配置" 
          name="llm_config_id"
          className="property-panel-form-item"
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#999' }}>
                从设置页面配置的模型中选择
              </span>
              <Button 
                type="link" 
                size="small" 
                icon={<SettingOutlined />}
                onClick={() => window.open('/mainmenu/llm', '_blank')}
                className="property-panel-link-btn"
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
          <Card size="small" className="property-panel-model-card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Tag className={`property-panel-tag property-panel-tag-provider-${selectedLLMConfig.provider}`}>
                {selectedLLMConfig.provider}
              </Tag>
              <Tag className="property-panel-tag property-panel-tag-model">
                {selectedLLMConfig.name}
              </Tag>
              {selectedLLMConfig.is_default && (
                <Tag className="property-panel-tag property-panel-tag-default">
                  默认
                </Tag>
              )}
            </div>

            <Form.Item name="temperature" label="温度 (0-2)" style={{ marginBottom: 8 }}>
              <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="max_tokens" label="最大Token" style={{ marginBottom: 8 }}>
              <InputNumber min={1} max={128000} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="frequency_penalty" label="频率惩罚 (-2 到 2)" style={{ marginBottom: 8 }}>
              <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="presence_penalty" label="存在惩罚 (-2 到 2)" style={{ marginBottom: 8 }}>
              <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
            </Form.Item>
          </Card>
        )}

        <Divider className="property-panel-divider">提示词配置</Divider>

        <div className="property-panel-btn-group">
          <Button 
            className="property-panel-btn property-panel-btn-primary"
            onClick={generateSmartPrompt}
            icon={<ThunderboltOutlined />}
          >
            智能生成
          </Button>
          <Button 
            className="property-panel-btn"
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
            <Button className="property-panel-btn">
              变量说明
            </Button>
          </Popover>
          <Button 
            className="property-panel-btn"
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
          className="property-panel-form-item"
        >
          <TextArea 
            className="property-panel-textarea"
            rows={4} 
            placeholder="请输入系统提示词" 
          />
        </Form.Item>

        <Form.Item
          label="User Prompt"
          name="user_prompt"
          extra="支持变量插值，如 {user_input}"
          className="property-panel-form-item"
        >
          <TextArea 
            className="property-panel-textarea"
            rows={3} 
            placeholder="请输入用户提示词" 
          />
        </Form.Item>

        {showAssistantPrompt && (
          <Form.Item
            label="Assistant Prompt"
            name="assistant_prompt"
            extra="支持变量插值，如 {execution_history}"
            className="property-panel-form-item"
          >
            <TextArea 
              className="property-panel-textarea"
              rows={3} 
              placeholder="请输入助手提示词" 
            />
          </Form.Item>
        )}

        <Button 
          type="link" 
          size="small" 
          onClick={() => setShowAssistantPrompt(!showAssistantPrompt)}
          className="property-panel-link-btn"
          style={{ marginBottom: 16 }}
        >
          {showAssistantPrompt ? '隐藏' : '显示'} Assistant Prompt
        </Button>

        <Divider className="property-panel-divider">
          <FolderOutlined style={{ marginRight: 8 }} />
          Skills 包绑定
        </Divider>

        <Form.Item 
          label="绑定的 Skills 包" 
          name="skills"
          className="property-panel-form-item"
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>从主菜单管理 Skills 包</span>
              <Button 
                type="link" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={loadSkillsPackages}
                loading={loadingSkills}
                className="property-panel-link-btn"
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
            {(() => {
              const selectedSkills = form.getFieldValue('skills') || [];
              const enabledIds = new Set(skillsPackages.map(pkg => pkg.id));

              return [
                ...skillsPackages.map(pkg => (
                  <Select.Option
                    key={pkg.id}
                    value={pkg.id}
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
                )),
                ...allSkillsPackages
                  .filter(pkg => !enabledIds.has(pkg.id) && selectedSkills.includes(pkg.id))
                  .map(pkg => (
                    <Select.Option
                      key={pkg.id}
                      value={pkg.id}
                      label={pkg.name}
                      disabled
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
                  ))
              ];
            })()}
          </Select>
        </Form.Item>

        <Divider className="property-panel-divider">
          <ToolOutlined style={{ marginRight: 8 }} />
          本地工具绑定
        </Divider>

        <Form.Item 
          label="绑定的本地工具" 
          name="tools"
          className="property-panel-form-item"
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>SoloAgent 内置工具</span>
              <Button 
                type="link" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={loadLocalTools}
                loading={loadingLocalTools}
                className="property-panel-link-btn"
              >
                刷新
              </Button>
            </div>
          }
        >
          <Select 
            mode="multiple" 
            placeholder={loadingLocalTools ? "加载中..." : "请选择本地工具"}
            loading={loadingLocalTools}
            optionLabelProp="label"
          >
            {SOLOAGENT_TOOLS.map(tool => (
              <Select.Option 
                key={tool.name} 
                value={tool.name}
                label={tool.name}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span>{tool.name}</span>
                  {tool.description && (
                    <span style={{ fontSize: 12, color: '#999' }}>
                      {tool.description}
                    </span>
                  )}
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Divider className="property-panel-divider">
          <ToolOutlined style={{ marginRight: 8 }} />
          MCP 工具绑定
        </Divider>

        <Form.Item 
          label="绑定的 MCP 工具" 
          name="mcp_tools"
          className="property-panel-form-item"
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>从主菜单管理 MCP 服务器</span>
              <Button 
                type="link" 
                size="small" 
                icon={<ReloadOutlined />} 
                onClick={loadMCPTools}
                loading={loadingTools}
                className="property-panel-link-btn"
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
            {(() => {
              const selectedMcpTools = form.getFieldValue('mcp_tools') || [];
              const enabledToolKeys = new Set(mcpTools.map(tool => `${tool.server_id}:${tool.name}`));

              return [
                ...mcpTools.map(tool => (
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
                )),
                ...allMcpTools
                  .filter(tool => {
                    const toolKey = `${tool.server_id}:${tool.name}`;
                    return !enabledToolKeys.has(toolKey) && selectedMcpTools.includes(toolKey);
                  })
                  .map(tool => (
                    <Select.Option
                      key={`${tool.server_id}:${tool.name}`}
                      value={`${tool.server_id}:${tool.name}`}
                      label={tool.name}
                      disabled
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
                  ))
              ];
            })()}
          </Select>
        </Form.Item>
      </Form>

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
                      className="property-panel-template-card"
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
                        <Button type="link" className="property-panel-link-btn">应用</Button>
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
                      className="property-panel-template-card"
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
                        <Button type="link" className="property-panel-link-btn">应用</Button>
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
        <div className="property-panel-preview-section">
          <Text strong>原始提示词:</Text>
          <Card size="small" style={{ marginTop: 8, background: '#f5f5f5', maxHeight: 150, overflow: 'auto' }} className="property-panel-preview-box">
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {form.getFieldValue('system_prompt')}
            </pre>
          </Card>
        </div>
        
        <div className="property-panel-preview-section">
          <Text strong>插值后预览:</Text>
          <Card size="small" style={{ marginTop: 8, background: '#e6f7ff', maxHeight: 200, overflow: 'auto' }} className="property-panel-preview-box blue">
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
