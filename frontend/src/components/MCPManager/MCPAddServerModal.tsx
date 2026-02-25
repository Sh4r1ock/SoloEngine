import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, InputNumber, Switch, message, Button, Card, Row, Col } from 'antd';
import { MCPServer } from '../../services/mcpApi';
import { mcpApi } from '../../services/mcpApi';

const { Option } = Select;
const { TextArea } = Input;

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
    const [transportType, setTransportType] = useState<string>('stdio');

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
                });
                setTransportType(server.transport || 'stdio');
            } else {
                form.resetFields();
                form.setFieldsValue({
                    transport: 'stdio',
                    timeout: 30,
                    enabled: true,
                });
                setTransportType('stdio');
            }
        }
    }, [visible, server, form]);

    const handleTransportChange = (value: string) => {
        setTransportType(value);
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
            width={700}
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
                                label="传输类型"
                                name="transport"
                                rules={[{ required: true, message: '请选择传输类型' }]}
                            >
                                <Select onChange={handleTransportChange}>
                                    <Option value="stdio">Stdio (本地进程)</Option>
                                    <Option value="sse">SSE (Server-Sent Events)</Option>
                                    <Option value="http">HTTP (Streamable HTTP)</Option>
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
                            <Input placeholder="例如: npx 或 python" />
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

                <Button onClick={handleTest} loading={testing}>
                    测试连接
                </Button>
            </Form>
        </Modal>
    );
};

export default MCPAddServerModal;
