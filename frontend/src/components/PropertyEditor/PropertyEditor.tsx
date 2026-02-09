import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Form, Input, Select, Button, Typography, Divider, message } from 'antd';
import { useCanvasStore } from '../../store/canvasStore';
import { generateOrchestratorPrompt, generatePlannerPrompt, generateExecutorPrompt } from '../../utils/promptGenerator';

const { TextArea } = Input;
const { Text } = Typography;

const PropertyPanel: React.FC = () => {
  const { selectedNode, updateNode, nodes, edges, saveCanvas } = useCanvasStore();
  const [form] = Form.useForm();
  const [showAssistantPrompt, setShowAssistantPrompt] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedNode) {
      form.setFieldsValue({
        name: selectedNode.data.name || '',
        desc: selectedNode.data.desc || '',
        agentType: selectedNode.data.agentType || 'executor',
        model_provider: selectedNode.data.model_config?.provider || 'openai',
        model_name: selectedNode.data.model_config?.model || 'gpt-4',
        system_prompt: selectedNode.data.system_prompt || '',
        user_prompt: selectedNode.data.user_prompt || '',
        assistant_prompt: selectedNode.data.assistant_prompt || '',
      });
    }
  }, [selectedNode, form]);

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
        model_config: {
          provider: values.model_provider,
          model: values.model_name,
        },
      });

      await saveCanvas();
    } catch (error) {
      message.error('保存失败，请重试');
    }
  }, [selectedNode, form, updateNode, saveCanvas]);

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

        <Form.Item label="模型提供商" name="model_provider">
          <Select>
            <Select.Option value="openai">OpenAI</Select.Option>
            <Select.Option value="anthropic">Anthropic</Select.Option>
            <Select.Option value="qwen">通义千问</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item label="模型名称" name="model_name">
          <Select>
            <Select.Option value="gpt-4">GPT-4</Select.Option>
            <Select.Option value="gpt-3.5-turbo">GPT-3.5 Turbo</Select.Option>
            <Select.Option value="claude-3">Claude 3</Select.Option>
            <Select.Option value="qwen-max">通义千问 Max</Select.Option>
          </Select>
        </Form.Item>

        <Divider>提示词配置</Divider>

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

        <Button type="default" onClick={generateSmartPrompt} style={{ marginBottom: 16 }}>
          智能生成提示词
        </Button>

        <Divider>技能绑定</Divider>

        <Form.Item label="绑定的技能" name="skills">
          <Select mode="tags" placeholder="请选择或输入技能">
            <Select.Option value="search">搜索</Select.Option>
            <Select.Option value="file_read">文件读取</Select.Option>
            <Select.Option value="file_write">文件写入</Select.Option>
            <Select.Option value="database_query">数据库查询</Select.Option>
          </Select>
        </Form.Item>
      </Form>
    </>
  );
};

export default PropertyPanel;
