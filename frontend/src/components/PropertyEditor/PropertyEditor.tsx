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
import { Form, Input, Select, Button, Typography, App } from 'antd';
import { ToolOutlined, FolderOutlined, ThunderboltOutlined, SettingOutlined, TeamOutlined, UserOutlined, RobotOutlined, CaretRightOutlined, EditOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { useCanvasStore } from '../../store/canvasStore';
import { useMCPStore } from '../../store/mcpStore';
import { useRunStore } from '../../store/runStore';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import { mcpApi, MCPTool, MCPServer } from '../../services/mcpApi';
import { llmApi, LLMConfig } from '../../services/llmApi';
import { toolsApi, ToolInfo, AgentPreset } from '../../services/toolsApi';
import { getPresets } from '../../stores/presetsStore';
import { LLM_DEFAULTS } from '../../config/llmDefaults';
import LLMConfigSelector from '../Settings/LLMConfigSelector';
import ConfirmDialog from '../common/ConfirmDialog';

const { TextArea } = Input;
const { Text, Title } = Typography;

const SOLOAGENT_TOOLS = [
  { name: 'Read', description: '读取文件内容' },
  { name: 'Write', description: '写入文件内容' },
  { name: 'DeleteFile', description: '删除文件' },
  { name: 'LS', description: '列出目录内容' },
  { name: 'SearchReplace', description: '搜索替换文件内容' },
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
  { name: 'MCP', description: '调用MCP服务器工具' },
  { name: 'TodoWrite', description: '管理待办事项' },
  { name: 'AskUserQuestion', description: '询问用户问题' },
  { name: 'OpenPreview', description: '打开预览' },
  { name: 'EnterPlanMode', description: '进入计划模式' },
  { name: 'ExitPlanMode', description: '退出计划模式' },
];

interface StepperInputProps {
  value?: number;
  onChange?: (value: number) => void;
  min: number;
  max: number;
  step: number;
}

const StepperInput: React.FC<StepperInputProps> = ({ value, onChange, min, max, step }) => {
  const handleStep = (delta: number) => {
    const current = value ?? 0;
    let newVal = current + delta;
    if (!isNaN(min) && newVal < min) newVal = min;
    if (!isNaN(max) && newVal > max) newVal = max;
    const decimals = (step.toString().split('.')[1] || '').length;
    onChange?.(decimals > 0 ? parseFloat(newVal.toFixed(decimals)) : newVal);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numVal = parseFloat(e.target.value);
    if (!isNaN(numVal)) {
      onChange?.(numVal);
    }
  };

  return (
    <div className="property-panel-model-config-param-input-wrapper">
      <button type="button" className="property-panel-model-config-param-stepper" onClick={() => handleStep(-step)}>−</button>
      <input
        className="property-panel-model-config-param-input"
        type="number"
        min={min} max={max} step={step}
        value={value ?? ''}
        onChange={handleInputChange}
      />
      <button type="button" className="property-panel-model-config-param-stepper" onClick={() => handleStep(step)}>+</button>
    </div>
  );
};

const PropertyPanel: React.FC = () => {
  const { message } = App.useApp();
  const { selectedNode, updateNode, nodes, edges, saveCanvas, configMap } = useCanvasStore();
  const [form] = Form.useForm();
  const { projectId } = useParams<{ projectId: string }>();
  const { currentSessionId } = useRunStore();
  
  const saveTimeoutRef = useRef<number | null>(null);
  const selectedNodeRef = useRef<typeof selectedNode>(null);
  const isInternalUpdateRef = useRef(false);
  const configMapRef = useRef(configMap);
  configMapRef.current = configMap;
  
  const [skillsPackages, setSkillsPackages] = useState<SkillsPackage[]>([]);
  const [allSkillsPackages, setAllSkillsPackages] = useState<SkillsPackage[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [allMcpServers, setAllMcpServers] = useState<MCPServer[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [allMcpTools, setAllMcpTools] = useState<MCPTool[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);
  const [localTools, setLocalTools] = useState<ToolInfo[]>([]);
  const [loadingLocalTools, setLoadingLocalTools] = useState(false);

  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfig | null>(null);
  const selectedLLMConfigRef = useRef<LLMConfig | null>(null);
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);
  const [agentTypeValue, setAgentTypeValue] = useState<string>('executor');
  const prevNodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedLLMConfigRef.current = selectedLLMConfig;
  }, [selectedLLMConfig]);

  useEffect(() => {
    // 仅在节点选中（Form 已挂载连接）时同步 agentType，避免 form 未连接告警
    if (selectedNode) {
      form.setFieldsValue({ agentType: agentTypeValue });
    }
  }, [agentTypeValue, form, selectedNode]);

  useEffect(() => {
    selectedNodeRef.current = selectedNode;

    const nodeIdChanged = prevNodeIdRef.current !== (selectedNode?.id ?? null);

    if (nodeIdChanged) {
      selectedLLMConfigRef.current = null;
      setSelectedLLMConfig(null);
    }

    if (selectedNode) {
      const nodeModelConfig: Record<string, any> = selectedNode.data.model_config || {};
      isInternalUpdateRef.current = true;
      form.setFieldsValue({
        name: selectedNode.data.name || '',
        desc: selectedNode.data.desc || '',
        agentType: selectedNode.data.agentType || 'executor',
        system_prompt: selectedNode.data.system_prompt || '',
        skills: selectedNode.data.skills || [],
        mcp_servers: selectedNode.data.mcp_servers || [],
        tools: selectedNode.data.tools || [],
        temperature: nodeModelConfig.temperature,
        // 回显 canvas 真实值：canvas 有 max_output_tokens 就用 canvas 的，缺失不降级到 max_tokens（直接显示空，由用户配置）
        max_output_tokens: nodeModelConfig.max_output_tokens,
        max_input_tokens: nodeModelConfig.max_input_tokens,
        frequency_penalty: nodeModelConfig.frequency_penalty,
        presence_penalty: nodeModelConfig.presence_penalty,
        max_tool_calls: nodeModelConfig.max_tool_calls,
      });
      setTimeout(() => { isInternalUpdateRef.current = false; }, 0);
      setAgentTypeValue(selectedNode.data.agentType || 'executor');
      if (nodeIdChanged) {
        setPendingPresetId(null);
      }
      prevNodeIdRef.current = selectedNode.id;
      const nodeId = selectedNode.id;

      if (nodeModelConfig.llm_config_id) {
        const cached = configMapRef.current.get(nodeModelConfig.llm_config_id);
        if (cached) {
          setSelectedLLMConfig(cached);
          selectedLLMConfigRef.current = cached;
        } else {
          llmApi.getConfig(nodeModelConfig.llm_config_id).then(config => {
            if (selectedNodeRef.current?.id !== nodeId) return;
            setSelectedLLMConfig(config);
            selectedLLMConfigRef.current = config;
          }).catch((error) => {
            console.warn('Failed to load LLM config:', error);
          });
        }
      }
    }
  }, [selectedNode]);

  const loadSkillsPackages = async () => {
    setLoadingSkills(true);
    try {
      const response = await skillsApi.getPackages();
      if (response.code === 200) {
        const allPackages = response.data || [];
        setAllSkillsPackages(allPackages);
        setSkillsPackages(allPackages.filter((pkg: SkillsPackage) => pkg.is_active));
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
      if (response.code === 200) {
        const allServers = response.data || [];
        setAllMcpServers(allServers);
        // 参照Skills的简洁判断方式
        setMcpServers(allServers.filter((server: MCPServer) => server.is_active));

        const allTools: MCPTool[] = [];
        const enabledTools: MCPTool[] = [];

        for (const server of allServers) {
          if (server.tools && server.tools.length > 0) {
            const serverTools = server.tools.map((tool: MCPTool) => ({
              ...tool,
              server_id: server.id,
              server_name: server.name,
            }));
            allTools.push(...serverTools);
            if (server.is_active) {
              enabledTools.push(...serverTools);
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
  }, []);

  const handleSave = useCallback(async () => {
    const node = selectedNodeRef.current;
    if (!node) return;

    try {
      const values = form.getFieldsValue();
      const currentConfig = selectedLLMConfigRef.current;
      const existingModelConfig: Record<string, any> = node.data.model_config || {};

      const updateData: Record<string, any> = {};

      if (values.name !== undefined) updateData.name = values.name;
      if (values.desc !== undefined) updateData.desc = values.desc;
      if (values.agentType !== undefined) updateData.agentType = values.agentType;
      if (values.system_prompt !== undefined) updateData.system_prompt = values.system_prompt;
      if (values.skills !== undefined) updateData.skills = values.skills;
      if (values.mcp_servers !== undefined) updateData.mcp_servers = values.mcp_servers;
      if (values.tools !== undefined) updateData.tools = values.tools;

      const llmConfigId = currentConfig?.id || existingModelConfig.llm_config_id;

      if (llmConfigId) {
        updateData.model_config = {
          llm_config_id: llmConfigId,
          temperature: values.temperature,
          max_output_tokens: values.max_output_tokens,
          max_input_tokens: values.max_input_tokens,
          frequency_penalty: values.frequency_penalty,
          presence_penalty: values.presence_penalty,
          max_tool_calls: values.max_tool_calls,
        };
      }

      updateNode(node.id, updateData);
    } catch (error) {
      message.error('保存失败，请重试');
    }
  }, [form, updateNode]);

  const handleValuesChange = () => {
    if (isInternalUpdateRef.current) return;

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

  const hasPresetDiff = (a: string[] | undefined, b: string[] | undefined) => {
    const sa = (a || []).slice().sort();
    const sb = (b || []).slice().sort();
    return JSON.stringify(sa) !== JSON.stringify(sb);
  };

  const handlePresetChange = (presetId: string) => {
    const preset = getPresets().find(p => p.id === presetId);
    if (!preset || !selectedNodeRef.current) return;

    const currentPreset = getPresets().find(p => p.id === agentTypeValue);
    const currentValues = form.getFieldsValue();

    const hasDiff =
      (currentValues.system_prompt || '').trim() !== (currentPreset?.system_prompt || '').trim() ||
      hasPresetDiff(currentValues.tools, currentPreset?.tools) ||
      hasPresetDiff(currentValues.skills, currentPreset?.skills) ||
      hasPresetDiff(currentValues.mcp_servers, currentPreset?.mcp_servers || currentPreset?.mcp_tools);

    if (hasDiff) {
      setPendingPresetId(presetId);
    } else {
      applyPresetChange(presetId);
    }
  };

  const applyPresetChange = (presetId: string) => {
    const preset = getPresets().find(p => p.id === presetId);
    const node = selectedNodeRef.current;
    if (!preset || !node) return;

    setAgentTypeValue(presetId);
    const values = form.getFieldsValue();
    form.setFieldsValue({
      agentType: preset.id,
      tools: preset.tools,
      skills: preset.skills,
      mcp_servers: preset.mcp_servers || preset.mcp_tools || [],
      system_prompt: preset.system_prompt,
    });
    updateNode(node.id, {
      name: values.name,
      desc: values.desc,
      agentType: preset.id as 'orchestrator' | 'planner' | 'executor' | 'custom',
      color: preset.color || '#3F51B5',
      system_prompt: preset.system_prompt,
      tools: preset.tools,
      skills: preset.skills,
      mcp_servers: preset.mcp_servers || preset.mcp_tools || [],
    });
    handleValuesChange();
  };

  const handleConfirmPresetChange = () => {
    if (pendingPresetId) {
      applyPresetChange(pendingPresetId);
      setPendingPresetId(null);
    }
  };

  const handleCancelPresetChange = () => {
    setPendingPresetId(null);
  };

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleLLMConfigChange = (configId: string, config: LLMConfig | null) => {
    setSelectedLLMConfig(config);
    selectedLLMConfigRef.current = config;
    setParamsExpanded(true);

    if (config) {
      // canvas 从 llm_config 获取默认值；llm_config 缺必填字段必须直接报错，禁止静默降级
      if (config.max_input_tokens == null) {
        message.error(`LLM 配置「${config.name}」缺少 max_input_tokens，无法应用到节点，请在模型管理中修复`);
        return;
      }
      if (config.max_tool_calls == null) {
        message.error(`LLM 配置「${config.name}」缺少 max_tool_calls（工具调用轮次），无法应用到节点，请在模型管理中修复`);
        return;
      }
      const params = {
        temperature: config.temperature,
        max_output_tokens: config.max_output_tokens ?? config.max_tokens,
        max_input_tokens: config.max_input_tokens,
        frequency_penalty: config.frequency_penalty,
        presence_penalty: config.presence_penalty,
        max_tool_calls: config.max_tool_calls,
      };
      form.setFieldsValue(params);

      configMapRef.current.set(config.id, config);

      isInternalUpdateRef.current = true;
      updateNode(selectedNodeRef.current!.id, {
        model_config: {
          llm_config_id: config.id,
          ...params,
        },
      });
      setTimeout(() => { isInternalUpdateRef.current = false; }, 0);
    }
  };

  const toggleParamsExpanded = () => setParamsExpanded(prev => !prev);

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
        {/* 1. 基本信息 */}
        <div className="property-panel-section">
          <div className="property-panel-section-head">
            <EditOutlined /> 基本信息
          </div>
          <div className="property-panel-section-body">
            <Form.Item
              label={<span className="property-panel-label-inline">节点名称</span>}
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
              label={<span className="property-panel-label-inline">Agent 类型</span>}
              rules={[{ required: true, message: '请选择 Agent 类型' }]}
              className="property-panel-form-item"
              style={{ marginBottom: 0 }}
            >
              <Select
                value={agentTypeValue}
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
          </div>
        </div>

        {/* 模型配置 - 统一面板 */}
        <div className="property-panel-model-config">
          <div className="property-panel-model-config-header">
            <RobotOutlined /> 模型配置
          </div>
          <div className="property-panel-model-config-body">
            <LLMConfigSelector value={selectedLLMConfig?.id} onChange={handleLLMConfigChange} showAddButton={true} />

            {selectedLLMConfig && (
              <>
                <div
                  className="property-panel-model-config-collapse"
                  onClick={toggleParamsExpanded}
                >
                  <CaretRightOutlined
                    className={`property-panel-model-config-collapse-arrow ${paramsExpanded ? 'expanded' : ''}`}
                  />
                  <span>参数</span>
                  <span className="property-panel-model-config-collapse-line" />
                </div>

                <div
                  className={`property-panel-model-config-params ${paramsExpanded ? 'expanded' : ''}`}
                  key={`params-${selectedNode?.id}-${selectedLLMConfig?.id}`}
                >
                <div className="property-panel-model-config-param">
                  <span className="property-panel-model-config-param-label">温度 (0-2)</span>
                  <Form.Item name="temperature" noStyle>
                    <StepperInput min={0} max={2} step={0.1} />
                  </Form.Item>
                </div>
                <div className="property-panel-model-config-param">
                  <span className="property-panel-model-config-param-label">最大输入</span>
                  <Form.Item name="max_input_tokens" noStyle>
                    <StepperInput min={1} max={LLM_DEFAULTS.MAX_TOKENS_LIMIT} step={1000} />
                  </Form.Item>
                </div>
                <div className="property-panel-model-config-param">
                  <span className="property-panel-model-config-param-label">最大输出</span>
                  <Form.Item name="max_output_tokens" noStyle>
                    <StepperInput min={1} max={LLM_DEFAULTS.MAX_TOKENS_LIMIT} step={1000} />
                  </Form.Item>
                </div>
                <div className="property-panel-model-config-param">
                  <span className="property-panel-model-config-param-label">频率惩罚 (-2~2)</span>
                  <Form.Item name="frequency_penalty" noStyle>
                    <StepperInput min={-2} max={2} step={0.1} />
                  </Form.Item>
                </div>
                <div className="property-panel-model-config-param">
                  <span className="property-panel-model-config-param-label">存在惩罚 (-2~2)</span>
                  <Form.Item name="presence_penalty" noStyle>
                    <StepperInput min={-2} max={2} step={0.1} />
                  </Form.Item>
                </div>
                <div className="property-panel-model-config-param">
                  <span className="property-panel-model-config-param-label">工具调用轮次 (1~1000)</span>
                  <Form.Item name="max_tool_calls" noStyle>
                    <StepperInput min={1} max={1000} step={1} />
                  </Form.Item>
                </div>
              </div>
              </>
            )}
          </div>
        </div>

        {/* 3. 系统提示词 */}
        <div className="property-panel-section">
          <div className="property-panel-section-head">
            <ThunderboltOutlined /> 系统提示词
          </div>
          <div className="property-panel-section-body">
            <Form.Item
              name="system_prompt"
              className="property-panel-form-item"
              style={{ marginBottom: 0 }}
            >
              <TextArea
                className="property-panel-textarea"
                rows={8}
                placeholder="请输入系统提示词"
              />
            </Form.Item>
          </div>
        </div>

        {/* 4. 工具与集成 */}
        <div className="property-panel-section">
          <div className="property-panel-section-head">
            <ToolOutlined /> 工具与集成
          </div>
          <div className="property-panel-section-body">
            {/* 工具 */}
            <div className="property-panel-subsection">
              <div className="property-panel-subsection-label">
                <ToolOutlined /> 工具
              </div>
              <Form.Item
                name="tools"
                className="property-panel-form-item"
                style={{ marginBottom: 0 }}
              >
                <Select
                  mode="multiple"
                  placeholder={loadingLocalTools ? "加载中..." : "请选择工具"}
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
            </div>
            {/* Skills */}
            <div className="property-panel-subsection">
              <div className="property-panel-subsection-label">
                <FolderOutlined /> Skills
              </div>
              <Form.Item
                name="skills"
                className="property-panel-form-item"
                style={{ marginBottom: 0 }}
              >
                <Select
                  mode="multiple"
                  placeholder={loadingSkills ? "加载中..." : "请选择 Skills"}
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
                            {pkg.description && (
                              <span style={{
                                fontSize: 12,
                                color: '#999',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%'
                              }} title={pkg.description}>
                                {pkg.description}
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
                              {pkg.description && (
                                <span style={{
                                  fontSize: 12,
                                  color: '#999',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: '100%'
                                }} title={pkg.description}>
                                  {pkg.description}
                                </span>
                              )}
                            </div>
                          </Select.Option>
                        ))
                    ];
                  })()}
                </Select>
              </Form.Item>
            </div>
            {/* MCP */}
            <div className="property-panel-subsection">
              <div className="property-panel-subsection-label">
                <SettingOutlined /> MCP
              </div>
              <Form.Item
                name="mcp_servers"
                className="property-panel-form-item"
                style={{ marginBottom: 0 }}
              >
                <Select
                  mode="multiple"
                  placeholder={loadingTools ? "加载中..." : "请选择 MCP"}
                  loading={loadingTools}
                  optionLabelProp="label"
                >
                  {(() => {
                    const selectedMcpServers = form.getFieldValue('mcp_servers') || [];
                    const enabledServerIds = new Set(mcpServers.map(s => s.id));

                    return [
                      ...mcpServers.map(server => (
                        <Select.Option
                          key={server.id}
                          value={server.id}
                          label={server.name}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>{server.name}</span>
                            {server.description && (
                              <span style={{
                                fontSize: 12,
                                color: '#999',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%'
                              }} title={server.description}>
                                {server.description}
                              </span>
                            )}
                          </div>
                        </Select.Option>
                      )),
                      ...allMcpServers
                        .filter(server => {
                          return !enabledServerIds.has(server.id) && selectedMcpServers.includes(server.id);
                        })
                        .map(server => (
                          <Select.Option
                            key={server.id}
                            value={server.id}
                            label={server.name}
                            disabled
                          >
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>{server.name}</span>
                              {server.description && (
                                <span style={{
                                  fontSize: 12,
                                  color: '#999',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: '100%'
                                }} title={server.description}>
                                  {server.description}
                                </span>
                              )}
                            </div>
                          </Select.Option>
                        ))
                    ];
                  })()}
                </Select>
              </Form.Item>
            </div>
          </div>
          <div className="property-panel-section-foot">
            <span>在设置页面中管理工具、Skills 和 MCP</span>
          </div>
        </div>
      </Form>
      <ConfirmDialog
        open={pendingPresetId !== null}
        title="切换节点类型"
        content="切换节点类型，会导致当前自定义的提示词、工具、Skills、MCP 内容被覆盖。是否确认切换？"
        okText="确认切换"
        cancelText="取消"
        danger
        onOk={handleConfirmPresetChange}
        onCancel={() => handleCancelPresetChange()}
      />
    </>
  );
};

export default PropertyPanel;
