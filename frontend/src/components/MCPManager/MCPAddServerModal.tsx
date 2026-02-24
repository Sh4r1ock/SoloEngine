import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, InputNumber, Switch, message, Button, Divider, Space, Alert, Card, Row, Col, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { MCPServer } from '../../services/mcpApi';
import { mcpApi } from '../../services/mcpApi';

const { Option } = Select;
const { TextArea } = Input;

const defaultPythonTemplate = `# -*- coding: utf-8 -*-
"""
自定义MCP工具模块
用户只需要定义 main() 函数
"""

def main(query: str, limit: int = 10) -> dict:
    """
    工具主函数
    
    Args:
        query: 查询关键词
        limit: 返回数量限制
    
    Returns:
        dict: 返回结果
    """
    results = []
    for i in range(limit):
        results.append({
            "id": i,
            "text": f"Result for: {query}"
        })
    
    return {
        "status": "success",
        "data": results,
        "total": len(results)
    }
`;

interface ParameterConfig {
    name: string;
    type: string;
    description: string;
    required: boolean;
    default?: string;
}

interface OutputFieldConfig {
    name: string;
    type: string;
    description: string;
}

interface MCPAddServerModalProps {
    visible: boolean;
    server: MCPServer | null;
    onClose: () => void;
    onSave: () => void;
}

const MCPAddServerModal: React.FC<MCPAddServerModalProps> = ({
    visible,
    server,
    onClose,
    onSave,
}) => {
    const [form] = Form.useForm();
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [transportType, setTransportType] = useState<string>('python');
    const [inputParams, setInputParams] = useState<ParameterConfig[]>([]);
    const [outputFields, setOutputFields] = useState<OutputFieldConfig[]>([]);
    const [pythonCode, setPythonCode] = useState(defaultPythonTemplate);

    useEffect(() => {
        if (visible) {
            if (server) {
                form.setFieldsValue({
                    name: server.name,
                    description: server.description || '',
                    transport: server.transport,
                    url: server.url,
                    command: server.command,
                    args: server.args ? server.args.join('\n') : '',
                    env: server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
                    headers: server.headers ? Object.entries(server.headers).map(([k, v]) => `${k}=${v}`).join('\n') : '',
                    timeout: server.timeout || 30,
                    enabled: server.enabled !== false,
                    module: server.module || '',
                    function: server.function || 'main',
                });
                setTransportType(server.transport || 'python');
                
                if (server.inputSchema?.properties) {
                    const params: ParameterConfig[] = Object.entries(server.inputSchema.properties).map(([name, schema]: [string, any]) => ({
                        name,
                        type: schema.type || 'string',
                        description: schema.description || '',
                        required: server.inputSchema.required?.includes(name) || false,
                        default: schema.default,
                    }));
                    setInputParams(params);
                }
                
                if (server.outputSchema?.properties) {
                    const fields: OutputFieldConfig[] = Object.entries(server.outputSchema.properties).map(([name, schema]: [string, any]) => ({
                        name,
                        type: schema.type || 'string',
                        description: schema.description || '',
                    }));
                    setOutputFields(fields);
                }
                
                if (server.python_code) {
                    setPythonCode(server.python_code);
                }
            } else {
                form.resetFields();
                form.setFieldsValue({
                    transport: 'python',
                    timeout: 30,
                    enabled: true,
                    function: 'main',
                });
                setTransportType('python');
                setInputParams([]);
                setOutputFields([]);
                setPythonCode(defaultPythonTemplate);
            }
        }
    }, [visible, server, form]);

    const handleTransportChange = (value: string) => {
        setTransportType(value);
    };

    const addInputParam = () => {
        setInputParams([...inputParams, { name: '', type: 'string', description: '', required: false }]);
    };

    const removeInputParam = (index: number) => {
        setInputParams(inputParams.filter((_, i) => i !== index));
    };

    const updateInputParam = (index: number, field: keyof ParameterConfig, value: any) => {
        const newParams = [...inputParams];
        newParams[index] = { ...newParams[index], [field]: value };
        setInputParams(newParams);
    };

    const addOutputField = () => {
        setOutputFields([...outputFields, { name: '', type: 'string', description: '' }]);
    };

    const removeOutputField = (index: number) => {
        setOutputFields(outputFields.filter((_, i) => i !== index));
    };

    const updateOutputField = (index: number, field: keyof OutputFieldConfig, value: any) => {
        const newFields = [...outputFields];
        newFields[index] = { ...newFields[index], [field]: value };
        setOutputFields(newFields);
    };

    const buildInputSchema = () => {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        
        inputParams.forEach(param => {
            if (param.name) {
                properties[param.name] = {
                    type: param.type,
                    description: param.description,
                };
                if (param.default !== undefined && param.default !== '') {
                    properties[param.name].default = param.default;
                }
                if (param.required) {
                    required.push(param.name);
                }
            }
        });
        
        return {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined,
        };
    };

    const buildOutputSchema = () => {
        const properties: Record<string, any> = {};
        
        outputFields.forEach(field => {
            if (field.name) {
                properties[field.name] = {
                    type: field.type,
                    description: field.description,
                };
            }
        });
        
        return {
            type: 'object',
            properties,
        };
    };

    const handleTest = async () => {
        try {
            const values = await form.validateFields();
            setTesting(true);

            const config: any = {
                name: values.name,
                transport: values.transport,
                timeout: values.timeout,
            };

            if (values.description) {
                config.description = values.description;
            }

            if (values.transport === 'http' || values.transport === 'sse') {
                config.url = values.url;
                if (values.headers) {
                    config.headers = {};
                    values.headers.split('\n').forEach((line: string) => {
                        const [key, ...valueParts] = line.split('=');
                        if (key && valueParts.length > 0) {
                            config.headers[key.trim()] = valueParts.join('=').trim();
                        }
                    });
                }
            } else if (values.transport === 'stdio') {
                config.command = values.command;
                if (values.args) {
                    config.args = values.args.split('\n').filter((a: string) => a.trim());
                }
                if (values.env) {
                    config.env = {};
                    values.env.split('\n').forEach((line: string) => {
                        const [key, ...valueParts] = line.split('=');
                        if (key && valueParts.length > 0) {
                            config.env[key.trim()] = valueParts.join('=').trim();
                        }
                    });
                }
            } else if (values.transport === 'python') {
                config.module = values.module;
                config.function = values.function || 'main';
                config.inputSchema = buildInputSchema();
                config.outputSchema = buildOutputSchema();
            }

            const response = await mcpApi.testServer(config);
            if (response.code === 200) {
                if (response.data?.connected) {
                    message.success(`连接测试成功！发现 ${response.data?.tools_count || 0} 个工具`);
                } else {
                    message.warning('连接测试失败：' + (response.data?.error || '未知错误'));
                }
            } else {
                message.error('连接测试失败：' + response.message);
            }
        } catch (error) {
            message.error('连接测试失败：' + String(error));
        } finally {
            setTesting(false);
        }
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            setSaving(true);

            const config: any = {
                name: values.name,
                transport: values.transport,
                timeout: values.timeout,
                enabled: values.enabled,
            };

            if (values.description) {
                config.description = values.description;
            }

            if (values.transport === 'http' || values.transport === 'sse') {
                config.url = values.url;
                if (values.headers) {
                    config.headers = {};
                    values.headers.split('\n').forEach((line: string) => {
                        const [key, ...valueParts] = line.split('=');
                        if (key && valueParts.length > 0) {
                            config.headers[key.trim()] = valueParts.join('=').trim();
                        }
                    });
                }
            } else if (values.transport === 'stdio') {
                config.command = values.command;
                if (values.args) {
                    config.args = values.args.split('\n').filter((a: string) => a.trim());
                }
                if (values.env) {
                    config.env = {};
                    values.env.split('\n').forEach((line: string) => {
                        const [key, ...valueParts] = line.split('=');
                        if (key && valueParts.length > 0) {
                            config.env[key.trim()] = valueParts.join('=').trim();
                        }
                    });
                }
            } else if (values.transport === 'python') {
                config.module = values.module;
                config.function = values.function || 'main';
                config.inputSchema = buildInputSchema();
                config.outputSchema = buildOutputSchema();
            }

            if (server) {
                await mcpApi.updateServer(server.id, { ...config, version: server.version });
                message.success('MCP 工具已更新');
            } else {
                const response = await mcpApi.addServer(config);
                if (response.code === 200) {
                    message.success('MCP 工具已添加');
                }
            }

            onSave();
        } catch (error) {
            message.error('保存失败：' + String(error));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            title={server ? '编辑 MCP 工具' : '新建 MCP'}
            open={visible}
            onCancel={onClose}
            onOk={handleSave}
            okText="保存"
            cancelText="取消"
            confirmLoading={saving}
            width={900}
        >
            <Form form={form} layout="vertical">
                <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                label="服务名称"
                                name="name"
                                rules={[{ required: true, message: '请输入服务名称' }]}
                            >
                                <Input placeholder="例如: my_tool" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label="类型"
                                name="transport"
                                rules={[{ required: true, message: '请选择类型' }]}
                            >
                                <Select onChange={handleTransportChange}>
                                    <Option value="python">自定义 Python 函数</Option>
                                    <Option value="stdio">Stdio (本地进程)</Option>
                                    <Option value="http">HTTP</Option>
                                    <Option value="sse">SSE (Server-Sent Events)</Option>
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item
                        label="服务描述"
                        name="description"
                    >
                        <Input placeholder="例如: 查询数据库工具" />
                    </Form.Item>
                </Card>

                {transportType === 'python' && (
                    <Card title="Python 类型配置" size="small" style={{ marginBottom: 16 }}>
                        <Alert
                            message="自定义 Python 函数"
                            description="用户只需要定义 main() 函数，系统会自动包装为 MCP 工具。通过下方配置输入输出参数 Schema。"
                            type="info"
                            showIcon
                            style={{ marginBottom: 16 }}
                        />
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item
                                    label="Python 模块"
                                    name="module"
                                    rules={[{ required: true, message: '请输入 Python 模块名' }]}
                                    extra="模块路径，如: my_tool 或 tools.database"
                                >
                                    <Input placeholder="my_tool" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item
                                    label="函数名"
                                    name="function"
                                    extra="默认为 main"
                                >
                                    <Input placeholder="main" />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Divider orientation="left" style={{ margin: '16px 0' }}>
                            输入参数配置
                        </Divider>
                        
                        {inputParams.map((param, index) => (
                            <Row gutter={8} key={index} style={{ marginBottom: 8 }}>
                                <Col span={5}>
                                    <Input
                                        placeholder="参数名"
                                        value={param.name}
                                        onChange={(e) => updateInputParam(index, 'name', e.target.value)}
                                    />
                                </Col>
                                <Col span={4}>
                                    <Select
                                        value={param.type}
                                        onChange={(v) => updateInputParam(index, 'type', v)}
                                    >
                                        <Option value="string">string</Option>
                                        <Option value="integer">integer</Option>
                                        <Option value="number">number</Option>
                                        <Option value="boolean">boolean</Option>
                                        <Option value="array">array</Option>
                                        <Option value="object">object</Option>
                                    </Select>
                                </Col>
                                <Col span={6}>
                                    <Input
                                        placeholder="描述"
                                        value={param.description}
                                        onChange={(e) => updateInputParam(index, 'description', e.target.value)}
                                    />
                                </Col>
                                <Col span={3}>
                                    <Tag
                                        color={param.required ? 'blue' : 'default'}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => updateInputParam(index, 'required', !param.required)}
                                    >
                                        {param.required ? '必填' : '可选'}
                                    </Tag>
                                </Col>
                                <Col span={4}>
                                    <Input
                                        placeholder="默认值"
                                        value={param.default}
                                        onChange={(e) => updateInputParam(index, 'default', e.target.value)}
                                    />
                                </Col>
                                <Col span={2}>
                                    <Button
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={() => removeInputParam(index)}
                                    />
                                </Col>
                            </Row>
                        ))}
                        <Button type="dashed" onClick={addInputParam} icon={<PlusOutlined />} block>
                            添加输入参数
                        </Button>

                        <Divider orientation="left" style={{ margin: '16px 0' }}>
                            输出参数配置
                        </Divider>
                        
                        {outputFields.map((field, index) => (
                            <Row gutter={8} key={index} style={{ marginBottom: 8 }}>
                                <Col span={6}>
                                    <Input
                                        placeholder="字段名"
                                        value={field.name}
                                        onChange={(e) => updateOutputField(index, 'name', e.target.value)}
                                    />
                                </Col>
                                <Col span={5}>
                                    <Select
                                        value={field.type}
                                        onChange={(v) => updateOutputField(index, 'type', v)}
                                    >
                                        <Option value="string">string</Option>
                                        <Option value="integer">integer</Option>
                                        <Option value="number">number</Option>
                                        <Option value="boolean">boolean</Option>
                                        <Option value="array">array</Option>
                                        <Option value="object">object</Option>
                                    </Select>
                                </Col>
                                <Col span={11}>
                                    <Input
                                        placeholder="描述"
                                        value={field.description}
                                        onChange={(e) => updateOutputField(index, 'description', e.target.value)}
                                    />
                                </Col>
                                <Col span={2}>
                                    <Button
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={() => removeOutputField(index)}
                                    />
                                </Col>
                            </Row>
                        ))}
                        <Button type="dashed" onClick={addOutputField} icon={<PlusOutlined />} block>
                            添加输出字段
                        </Button>
                    </Card>
                )}

                {(transportType === 'http' || transportType === 'sse') && (
                    <Card title={`${transportType.toUpperCase()} 类型配置`} size="small" style={{ marginBottom: 16 }}>
                        <Form.Item
                            label="服务器 URL"
                            name="url"
                            rules={[{ required: true, message: '请输入服务器 URL' }]}
                        >
                            <Input placeholder="例如: http://localhost:3000/sse" />
                        </Form.Item>

                        <Form.Item
                            label="请求头"
                            name="headers"
                            extra="每行一个，格式: key=value"
                        >
                            <TextArea
                                rows={3}
                                placeholder="Authorization=Bearer xxx&#10;X-Custom-Header=value"
                            />
                        </Form.Item>
                    </Card>
                )}

                {transportType === 'stdio' && (
                    <Card title="Stdio 类型配置" size="small" style={{ marginBottom: 16 }}>
                        <Form.Item
                            label="命令"
                            name="command"
                            rules={[{ required: true, message: '请输入命令' }]}
                        >
                            <Input placeholder="例如: npx" />
                        </Form.Item>

                        <Form.Item
                            label="参数"
                            name="args"
                            extra="每行一个参数"
                        >
                            <TextArea
                                rows={3}
                                placeholder="-y&#10;@modelcontextprotocol/server-github"
                            />
                        </Form.Item>

                        <Form.Item
                            label="环境变量"
                            name="env"
                            extra="每行一个，格式: key=value"
                        >
                            <TextArea
                                rows={3}
                                placeholder="GITHUB_TOKEN=xxx&#10;DEBUG=true"
                            />
                        </Form.Item>
                    </Card>
                )}

                <Card title="其他配置" size="small" style={{ marginBottom: 16 }}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                label="超时时间（秒）"
                                name="timeout"
                                rules={[{ required: true, message: '请输入超时时间' }]}
                            >
                                <InputNumber min={1} max={300} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label="启用"
                                name="enabled"
                                valuePropName="checked"
                            >
                                <Switch />
                            </Form.Item>
                        </Col>
                    </Row>
                </Card>

                <Space>
                    <Button onClick={handleTest} loading={testing}>
                        测试连接
                    </Button>
                    <span style={{ color: '#999', fontSize: 12 }}>
                        测试连接将尝试验证工具配置是否正确
                    </span>
                </Space>
            </Form>
        </Modal>
    );
};

export default MCPAddServerModal;
