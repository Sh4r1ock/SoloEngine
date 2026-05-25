import React, { useEffect, useState, useRef } from 'react';
import { Modal, Form, Input, Select, InputNumber, Switch, App, Button, Divider, Alert, Card, Row, Col, Tag, Tabs, Upload, Radio, List, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, FolderOpenOutlined, FileZipOutlined, ApiOutlined, CloudServerOutlined, CodeOutlined, ToolOutlined } from '@ant-design/icons';
import { MCPServer, MCPTool } from '../../services/mcpApi';
import { mcpApi, CreateHttpServerRequest, CreateSseServerRequest } from '../../services/mcpApi';

const { Option } = Select;
const { TextArea } = Input;

const defaultPythonTemplate = `# -*- coding: utf-8 -*-
"""
自定义MCP工具模块
主函数名必须为 main
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

interface MCPAddServerModalProps {
    visible: boolean;
    server: MCPServer | null;
    onClose: () => void;
    onSave: () => void;
}

type CreateType = 'python' | 'stdio' | 'http' | 'sse';

const MCPAddServerModal: React.FC<MCPAddServerModalProps> = ({
    visible,
    server,
    onClose,
    onSave,
}) => {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const [saving, setSaving] = useState(false);
    const [createType, setCreateType] = useState<CreateType>('python');
    const [inputParams, setInputParams] = useState<ParameterConfig[]>([]);
    const [pythonCode, setPythonCode] = useState(defaultPythonTemplate);
    const [stdioUploadType, setStdioUploadType] = useState<'zip' | 'folder'>('zip');
    const [fileList, setFileList] = useState<any[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [inputTagValue, setInputTagValue] = useState('');
    const [tools, setTools] = useState<MCPTool[]>([]);
    const [connecting, setConnecting] = useState(false);
    const [isOpeningDialog, setIsOpeningDialog] = useState(false);

    useEffect(() => {
        if (visible) {
            if (server) {
                form.setFieldsValue({
                    name: server.name,
                    description: server.description || '',
                    timeout: server.timeout || 30,
                    is_active: server.is_active !== false,
                    share: server.share || false,
                });
                
                // 加载标签
                setTags(server.tags || []);

                // 加载工具列表
                setTools(server.tools || []);

                // 使用source_type来确定创建类型，如果没有则使用transport
                const sourceType = server.source || server.transport || server.transport_type || 'stdio';
                
                // 如果是python_function类型，显示为python编辑模式
                if (sourceType === 'python_function') {
                    setCreateType('python');
                    // 加载原始Python代码
                    loadPythonCode(server.id);
                    // 加载工具定义
                    loadToolsConfig(server.id);
                } else {
                    setCreateType(sourceType as CreateType);
                }
                
                if (sourceType === 'http' || sourceType === 'sse') {
                    form.setFieldsValue({
                        url: server.url,
                        headers: server.headers ? Object.entries(server.headers).map(([k, v]) => `${k}=${v}`).join('\n') : '',
                    });
                    
                    if (sourceType === 'sse') {
                        form.setFieldsValue({
                            reconnect: true,
                            sse_endpoint: '/sse',
                            retry_interval: 5,
                            max_retries: 3,
                        });
                    }
                } else if (sourceType === 'stdio') {
                    form.setFieldsValue({
                        command: server.command,
                        args: server.args ? server.args.join('\n') : '',
                        env: server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
                    });
                }
            } else {
                form.resetFields();
                form.setFieldsValue({
                    timeout: 30,
                    is_active: true,
                    share: false,
                    reconnect: true,
                    sse_endpoint: '/sse',
                    retry_interval: 5,
                    max_retries: 3,
                });
                setCreateType('python');
                setInputParams([]);
                setPythonCode(defaultPythonTemplate);
                setFileList([]);
                setTags([]);
                setTools([]);
            }
        }
    }, [visible, server, form]);

    const loadPythonCode = async (serverId: string) => {
        try {
            const response = await mcpApi.getMCPOriginalCode(serverId);
            if (response && response.code) {
                setPythonCode(response.code);
            }
        } catch (error) {
            console.error('加载Python代码失败:', error);
        }
    };

    const loadToolsConfig = async (serverId: string) => {
        try {
            const response = await mcpApi.getMCPToolsJson(serverId);
            if (response && response.tools && response.tools.length > 0) {
                // 将tools.json转换为inputParams格式
                const tools = response.tools;
                const params: ParameterConfig[] = [];
                tools.forEach((tool: any) => {
                    if (tool.parameters && tool.parameters.properties) {
                        Object.entries(tool.parameters.properties).forEach(([key, value]: [string, any]) => {
                            params.push({
                                name: key,
                                type: value.type || 'string',
                                description: value.description || '',
                                required: tool.parameters.required?.includes(key) || false,
                            });
                        });
                    }
                });
                setInputParams(params);
            }
        } catch (error) {
            console.error('加载工具配置失败:', error);
        }
    };

    // 根据文件列表分析类型标签
    const analyzeFileTags = (files: any[]): string[] => {
        const tags = new Set<string>(['stdio']); // 基础标签
        
        for (const file of files) {
            const fileName = file.name || '';
            const lowerName = fileName.toLowerCase();
            
            // 根据文件名判断类型
            if (lowerName.endsWith('.py') || lowerName === '__main__.py') {
                tags.add('python');
            } else if (lowerName.endsWith('.js') || lowerName.endsWith('.mjs')) {
                tags.add('nodejs');
            } else if (lowerName.endsWith('.ts')) {
                tags.add('nodejs');
                tags.add('typescript');
            } else if (lowerName.endsWith('.go')) {
                tags.add('go');
            } else if (lowerName.endsWith('.rs')) {
                tags.add('rust');
            } else if (lowerName.endsWith('.java')) {
                tags.add('java');
            } else if (lowerName.endsWith('.php')) {
                tags.add('php');
            } else if (lowerName.endsWith('.sh')) {
                tags.add('shell');
            } else if (lowerName === 'package.json') {
                tags.add('nodejs');
            }
        }
        
        return Array.from(tags);
    };

    const handleCreateTypeChange = (e: any) => {
        const newType = e.target.value;
        setCreateType(newType);
        setFileList([]);
        
        // 根据创建类型设置默认标签（仅在新创建时，不是编辑模式）
        if (!server) {
            const defaultTags: string[] = [];
            if (newType === 'python') {
                defaultTags.push('python');
            } else if (newType === 'stdio') {
                defaultTags.push('stdio');
            } else if (newType === 'http') {
                defaultTags.push('http');
            } else if (newType === 'sse') {
                defaultTags.push('sse');
            }
            setTags(defaultTags);
        }
    };

    const handleTagInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputTagValue(e.target.value);
    };

    const handleTagInputConfirm = () => {
        if (inputTagValue && !tags.includes(inputTagValue)) {
            setTags([...tags, inputTagValue]);
        }
        setInputTagValue('');
    };

    const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleTagInputConfirm();
        }
    };

    const handleTagRemove = (removedTag: string) => {
        setTags(tags.filter(tag => tag !== removedTag));
    };

    const handleToolEnabledChange = async (toolName: string, isEnabled: boolean) => {
        // 更新本地状态
        setTools(prev => prev.map(tool =>
            tool.name === toolName ? { ...tool, is_enabled: isEnabled } : tool
        ));
    };

    const handleConnectAndLoadTools = async () => {
        setConnecting(true);
        try {
            const values = form.getFieldsValue();

            // 根据当前创建类型构建连接配置
            let config: any = {
                name: values.name || server?.name || 'test',
                transport: createType,
                timeout: values.timeout || 30,
            };

            if (createType === 'stdio') {
                // 优先使用服务器已有的配置
                let command = values.command;
                let args = values.args ? values.args.split('\n').filter(Boolean) : [];
                let env: Record<string, string> = {};

                // 如果是编辑模式且表单中没有配置，使用服务器配置
                if (server) {
                    // 优先使用服务器已有的command和args
                    if (!command) {
                        command = server.command || '';
                    }
                    if (args.length === 0) {
                        args = server.args && server.args.length > 0 ? server.args : [];
                    }
                    env = server.env || env;
                    
                    // 如果没有command和args，但有folder_path，自动构建
                    if (!command && args.length === 0 && server.folder_path) {
                        // 自动检测入口文件
                        const folderPath = server.folder_path;
                        // 检查常见的入口文件
                        const possibleEntries = [
                            'bin/index.js',
                            'bin/index.mjs',
                            'dist/index.js',
                            'dist/index.mjs',
                            'index.js',
                            'index.mjs',
                            'main.py',
                            '__main__.py',
                            'server.py',
                            'app.py',
                        ];
                        
                        // 根据文件扩展名判断命令
                        for (const entry of possibleEntries) {
                            if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
                                command = 'node';
                                args = [`${folderPath}\\${entry.replace('/', '\\')}`];
                                break;
                            } else if (entry.endsWith('.py')) {
                                command = 'python';
                                args = [`${folderPath}\\${entry.replace('/', '\\')}`];
                                break;
                            }
                        }
                        
                        // 如果没有找到特定入口文件，使用folder_path作为参数
                        if (!command) {
                            command = 'node';
                            args = [folderPath];
                        }
                    }
                }

                if (!command) {
                    message.error('请先配置命令');
                    return;
                }

                config.command = command;
                config.args = args;
                config.env = env;

                // 解析表单中的 env
                if (values.env) {
                    values.env.split('\n').forEach((line: string) => {
                        const [key, ...valueParts] = line.split('=');
                        if (key && valueParts.length > 0) {
                            config.env[key.trim()] = valueParts.join('=').trim();
                        }
                    });
                }
            } else if (createType === 'http' || createType === 'sse') {
                // 优先使用服务器已有的 URL
                let url = values.url;
                let headers: Record<string, string> = {};

                // 如果是编辑模式且表单中没有 URL，使用服务器配置
                if (server && !url) {
                    url = server.url;
                    headers = server.headers || headers;
                }

                if (!url) {
                    message.error('请先配置 URL');
                    return;
                }

                config.url = url;
                config.headers = headers;

                // 解析表单中的 headers
                if (values.headers) {
                    values.headers.split('\n').forEach((line: string) => {
                        const [key, ...valueParts] = line.split('=');
                        if (key && valueParts.length > 0) {
                            config.headers[key.trim()] = valueParts.join('=').trim();
                        }
                    });
                }
            } else if (createType === 'python') {
                // Python 类型直接从代码中解析工具定义
                const extractedTools = extractToolsFromPythonCode(pythonCode, inputParams);
                setTools(extractedTools);
                message.success(`已加载 ${extractedTools.length} 个工具`);
                return;
            }

            // 调用后端连接接口获取工具
            const response = await mcpApi.connectAndGetTools(config);
            if (response.code === 200 && response.data?.tools) {
                const loadedTools = response.data.tools.map((tool: any) => ({
                    name: tool.name,
                    description: tool.description || '',
                    input_schema: tool.input_schema || tool.inputSchema || {},
                    is_enabled: true,
                }));
                setTools(loadedTools);
                message.success(`成功加载 ${loadedTools.length} 个工具`);
            } else {
                message.warning('未获取到工具列表');
                setTools([]);
            }
        } catch (error: any) {
            // 处理 401 错误
            if (error.response?.status === 401) {
                message.error('连接失败：未授权（401）。请检查 API Key 或认证信息是否正确。');
            } else {
                message.error('连接失败：' + String(error.message || error));
            }
            setTools([]);
        } finally {
            setConnecting(false);
        }
    };

    // 从 Python 代码中提取工具定义
    const extractToolsFromPythonCode = (code: string, params: ParameterConfig[]): MCPTool[] => {
        // 简单解析：查找 main 函数定义
        const mainMatch = code.match(/def\s+main\s*\(([^)]*)\)/);
        if (!mainMatch) return [];

        return [{
            name: 'main',
            description: form.getFieldValue('description') || 'Python Function',
            input_schema: {
                type: 'object',
                properties: params.reduce((acc, param) => {
                    acc[param.name] = {
                        type: param.type,
                        description: param.description,
                    };
                    return acc;
                }, {} as Record<string, any>),
                required: params.filter(p => p.required).map(p => p.name),
            },
            is_enabled: true,
        }];
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

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            setSaving(true);
            console.log('[MCP Save] createType:', createType, 'server:', !!server, 'tools count:', tools.length);

            if (createType === 'python') {
                const tools = [{
                    function_name: 'main',
                    description: values.description || 'MCP工具',
                    parameters: inputParams.map(p => ({
                        name: p.name,
                        type: p.type,
                        description: p.description,
                        required: p.required,
                        default: p.default,
                    })),
                }];
                
                // 判断是更新还是创建：如果server存在且source_type是python_function，则是更新
                const isUpdate = server && (server.source === 'python_function' || server.source_type === 'python_function');
                
                if (isUpdate) {
                    // 更新现有的Python MCP
                    const updateResponse = await mcpApi.updateMCPOriginalCode(server.id, pythonCode);
                    const toolsResponse = await mcpApi.updateMCPTools(server.id, tools);

                    // 更新基本信息（描述、标签和工具列表）
                    const baseInfoResponse = await mcpApi.updateServer(server.id, {
                        description: values.description,
                        tags: tags,
                        tools: tools.map(t => ({
                            name: t.function_name,
                            description: values.description || 'MCP工具',
                            input_schema: {
                                type: 'object',
                                properties: t.parameters.reduce((acc: any, p: any) => {
                                    acc[p.name] = { type: p.type, description: p.description };
                                    return acc;
                                }, {}),
                                required: t.parameters.filter((p: any) => p.required).map((p: any) => p.name),
                            },
                            is_enabled: true,
                        })),
                    });

                    if (updateResponse.code === 200 && toolsResponse.code === 200 && baseInfoResponse.code === 200) {
                        message.success('Python MCP 更新成功！');
                        onSave();
                    } else {
                        message.error('更新失败：' + (updateResponse.message || toolsResponse.message || baseInfoResponse.message));
                    }
                } else {
                    // 创建新的Python MCP
                    const response = await mcpApi.createPythonMCP(
                        values.name,
                        values.description || '',
                        pythonCode,
                        tools,
                        tags
                    );
                    
                    if (response.code === 200) {
                        message.success('Python MCP 创建成功！');
                        onSave();
                    } else {
                        message.error('创建失败：' + response.message);
                    }
                }
            } else if (createType === 'stdio') {
                if (server) {
                    console.log('[MCP Save] Updating stdio server:', server.id, 'tools:', tools.length);
                    const response = await mcpApi.updateServer(server.id, {
                        description: values.description,
                        tags: tags,
                        tools: tools,
                    });
                    console.log('[MCP Save] Update response:', response.code, response.message);

                    if (response.code === 200) {
                        message.success('Stdio MCP 更新成功！');
                        onSave();
                    } else {
                        message.error('更新失败：' + response.message);
                    }
                } else {
                    // 创建新的 Stdio MCP
                    if (stdioUploadType === 'zip') {
                        if (!fileList.length || !fileList[0]?.originFileObj) {
                            message.error('请先选择ZIP包文件');
                            return;
                        }
                    } else if (stdioUploadType === 'folder') {
                        if (!fileList.length) {
                            message.error('请先选择文件夹');
                            return;
                        }

                        const validFiles = fileList.filter(f => f.originFileObj);
                        if (!validFiles.length) {
                            message.error('文件夹中没有有效文件');
                            return;
                        }
                    }

                    const packageFile = stdioUploadType === 'zip' ?
                        (fileList[0]?.originFileObj || undefined) :
                        null;

                    const files = stdioUploadType === 'folder' ?
                        fileList
                            .map(f => f.originFileObj)
                            .filter((f): f is File => f !== null && f !== undefined) :
                        undefined;

                    const filePaths = stdioUploadType === 'folder' ?
                        fileList.map(f => f.name).filter(Boolean) :
                        undefined;

                    const response = await mcpApi.createStdioMCP(
                        values.name,
                        values.description || '',
                        packageFile,
                        files,
                        filePaths,
                        tags
                    );
                    
                    if (response.code === 200) {
                        message.success('Stdio MCP 创建成功！');
                        onSave();
                    } else {
                        message.error('创建失败：' + response.message);
                    }
                }
            } else if (createType === 'http') {
                if (server) {
                    // 更新现有 HTTP MCP
                    const response = await mcpApi.updateServer(server.id, {
                        name: values.name,
                        description: values.description,
                        tags: tags,
                        url: values.url,
                        headers: values.headers ? Object.fromEntries(values.headers.split('\n').map((line: string) => {
                            const [key, ...valueParts] = line.split('=');
                            return [key.trim(), valueParts.join('=').trim()];
                        })) : {},
                        timeout: values.timeout,
                        is_active: values.is_active,
                        tools: tools,
                    });

                    if (response.code === 200) {
                        message.success('HTTP MCP 更新成功！');
                        onSave();
                    } else {
                        message.error('更新失败：' + response.message);
                    }
                } else {
                    // 创建新的 HTTP MCP
                    const headers: Record<string, string> = {};
                    if (values.headers) {
                        values.headers.split('\n').forEach((line: string) => {
                            const [key, ...valueParts] = line.split('=');
                            if (key && valueParts.length > 0) {
                                headers[key.trim()] = valueParts.join('=').trim();
                            }
                        });
                    }
                    
                    const request: CreateHttpServerRequest = {
                        name: values.name,
                        description: values.description,
                        url: values.url,
                        headers,
                        timeout: values.timeout,
                        session_id: values.session_id,
                        is_active: values.is_active,
                        share: values.share,
                        tags: tags,
                    };
                    
                    const response = await mcpApi.createHttpMCP(request);
                    if (response.code === 200) {
                        message.success('HTTP MCP 创建成功！');
                        onSave();
                    } else {
                        message.error('创建失败：' + response.message);
                    }
                }
            } else if (createType === 'sse') {
                if (server) {
                    // 更新现有 SSE MCP
                    const response = await mcpApi.updateServer(server.id, {
                        name: values.name,
                        description: values.description,
                        tags: tags,
                        url: values.url,
                        headers: values.headers ? Object.fromEntries(values.headers.split('\n').map((line: string) => {
                            const [key, ...valueParts] = line.split('=');
                            return [key.trim(), valueParts.join('=').trim()];
                        })) : {},
                        timeout: values.timeout,
                        is_active: values.is_active,
                        tools: tools,
                    });

                    if (response.code === 200) {
                        message.success('SSE MCP 更新成功！');
                        onSave();
                    } else {
                        message.error('更新失败：' + response.message);
                    }
                } else {
                    // 创建新的 SSE MCP
                    const headers: Record<string, string> = {};
                    if (values.headers) {
                        values.headers.split('\n').forEach((line: string) => {
                            const [key, ...valueParts] = line.split('=');
                            if (key && valueParts.length > 0) {
                                headers[key.trim()] = valueParts.join('=').trim();
                            }
                        });
                    }
                    
                    const request: CreateSseServerRequest = {
                        name: values.name,
                        description: values.description,
                        url: values.url,
                        headers,
                        timeout: values.timeout,
                        reconnect: values.reconnect,
                        sse_endpoint: values.sse_endpoint,
                        retry_interval: values.retry_interval,
                        max_retries: values.max_retries,
                        is_active: values.is_active,
                        share: values.share,
                        tags: tags,
                    };
                    
                    const response = await mcpApi.createSseMCP(request);
                    if (response.code === 200) {
                        message.success('SSE MCP 创建成功！');
                        onSave();
                    } else {
                        message.error('创建失败：' + response.message);
                    }
                }
            }
        } catch (error) {
            console.error('[MCP Save] Error:', error);
            message.error('保存失败：' + String(error));
        } finally {
            setSaving(false);
        }
    };

    const renderCreateTypeSelector = () => (
        <Card size="small" style={{ marginBottom: 16 }}>
            <Radio.Group value={createType} onChange={handleCreateTypeChange}>
                <Radio.Button value="python">
                    <CodeOutlined /> Python Function
                </Radio.Button>
                <Radio.Button value="stdio">
                    <FolderOpenOutlined /> Stdio
                </Radio.Button>
                <Radio.Button value="http">
                    <ApiOutlined /> HTTP
                </Radio.Button>
                <Radio.Button value="sse">
                    <CloudServerOutlined /> SSE
                </Radio.Button>
            </Radio.Group>
        </Card>
    );

    const renderBasicInfo = () => (
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
                    <Form.Item label="服务描述" name="description">
                        <Input placeholder="例如: 查询数据库工具" />
                    </Form.Item>
                </Col>
            </Row>
            <Row>
                <Col span={24}>
                    <Form.Item label="标签">
                        <div 
                            style={{ 
                                display: 'flex', 
                                flexWrap: 'wrap', 
                                gap: 4, 
                                alignItems: 'center',
                                padding: '1px 11px',
                                border: '1px solid #d9d9d9',
                                borderRadius: 6,
                                minHeight: 30,
                                backgroundColor: '#fff',
                                fontSize: 14,
                                transition: 'all 0.2s',
                                cursor: 'text',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#4096ff';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = '#d9d9d9';
                            }}
                            onClick={(e) => {
                                // 点击容器时聚焦到输入框
                                const input = e.currentTarget.querySelector('input');
                                if (input) {
                                    input.focus();
                                }
                            }}
                        >
                            {tags.map((tag, index) => (
                                <Tag
                                    key={tag}
                                    closable
                                    onClose={(e) => {
                                        e.stopPropagation();
                                        handleTagRemove(tag);
                                    }}
                                    style={{
                                        margin: 0,
                                        padding: '0 7px',
                                        fontSize: 14,
                                        lineHeight: '20px',
                                        borderRadius: 4,
                                        backgroundColor: tag === 'system' ? 'var(--primary-300)' : undefined,
                                        border: tag === 'system' ? '1px solid var(--primary-100)' : undefined,
                                        color: tag === 'system' ? 'var(--primary-100)' : undefined,
                                    }}
                                >
                                    {tag}
                                </Tag>
                            ))}
                            <Input
                                type="text"
                                style={{ 
                                    width: tags.length === 0 ? 120 : 80,
                                    border: 'none',
                                    backgroundColor: 'transparent',
                                    boxShadow: 'none',
                                    padding: 0,
                                    fontSize: 14,
                                    lineHeight: '20px',
                                }}
                                placeholder={tags.length === 0 ? "按回车添加标签" : ""}
                                value={inputTagValue}
                                onChange={handleTagInputChange}
                                onBlur={handleTagInputConfirm}
                                onKeyDown={handleTagInputKeyDown}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                    </Form.Item>
                </Col>
            </Row>
        </Card>
    );

    const renderPythonConfig = () => (
        <Card title="Python Function 配置" size="small" style={{ marginBottom: 16 }}>
            <Alert
                message="自定义 Python 函数"
                description="在下方代码编辑器中编写 Python 代码，主函数名必须为 main()。配置输入参数 Schema 后点击保存创建 MCP 工具。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
            />
            
            <Tabs
                defaultActiveKey="code"
                items={[
                    {
                        key: 'code',
                        label: 'Python 代码',
                        children: (
                            <>
                                <div style={{ marginBottom: 8 }}>
                                    <span style={{ color: '#666', fontSize: 12 }}>original.py</span>
                                </div>
                                <TextArea
                                    value={pythonCode}
                                    onChange={(e) => setPythonCode(e.target.value)}
                                    rows={15}
                                    style={{ 
                                        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                                        fontSize: 13,
                                        lineHeight: 1.5,
                                        backgroundColor: '#1e1e1e',
                                        color: '#d4d4d4',
                                        border: '1px solid #333',
                                    }}
                                    placeholder="编写 Python 代码..."
                                />
                            </>
                        ),
                    },
                    {
                        key: 'params',
                        label: '输入参数配置',
                        children: (
                            <>
                                <Divider orientation="left" style={{ margin: '8px 0 16px 0' }}>
                                    输入参数 Schema
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
                            </>
                        ),
                    },
                ]}
            />
        </Card>
    );

    const renderStdioConfig = () => {
        // 如果是编辑已有服务器，显示命令配置
        if (server) {
            return (
                <Card title="Stdio 命令配置" size="small" style={{ marginBottom: 16 }}>
                    <Alert
                        message="配置启动命令"
                        description="配置启动此 MCP Server 的命令和参数"
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                    <Form.Item
                        label="命令"
                        name="command"
                        rules={[{ required: true, message: '请输入启动命令' }]}
                    >
                        <Input placeholder="例如: node, python, npx" />
                    </Form.Item>
                    <Form.Item
                        label="参数"
                        name="args"
                        extra="每行一个参数"
                    >
                        <TextArea
                            rows={3}
                            placeholder="例如:&#10;./bin/index.js&#10;--port=3000"
                        />
                    </Form.Item>
                    <Form.Item
                        label="环境变量"
                        name="env"
                        extra="每行一个，格式: key=value"
                    >
                        <TextArea
                            rows={3}
                            placeholder="PATH=/usr/local/bin&#10;NODE_ENV=production"
                        />
                    </Form.Item>
                </Card>
            );
        }

        // 新建服务器时显示上传界面
        return (
            <Card title="Stdio 配置（上传 ZIP 包或文件夹）" size="small" style={{ marginBottom: 16 }}>
                <Alert
                    message="上传 MCP Server"
                    description={
                        <span>
                            上传 ZIP 包或文件夹，ZIP 包应包含 main.py 或 __main__.py 作为入口文件。
                            <br />
                            <strong>注意：</strong>文件夹选择功能需要使用 Chrome 或 Edge 浏览器，
                            且建议在 localhost 环境下运行以获得最佳体验。
                        </span>
                    }
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                />
                
                <Radio.Group value={stdioUploadType} onChange={(e) => { setStdioUploadType(e.target.value); setFileList([]); }} style={{ marginBottom: 16 }}>
                    <Radio.Button value="zip">
                        <FileZipOutlined /> ZIP 包
                    </Radio.Button>
                    <Radio.Button value="folder">
                        <FolderOpenOutlined /> 文件夹
                    </Radio.Button>
                </Radio.Group>
                
                {stdioUploadType === 'zip' ? (
                    <Upload
                        accept=".zip,.mcpb"
                        fileList={fileList}
                        beforeUpload={(file) => {
                            const nativeFile = (file as any).originFileObj || file;

                            setFileList([{
                                uid: file.uid || nativeFile.name,
                                name: nativeFile.name,
                                status: 'done' as const,
                                originFileObj: nativeFile,
                            }]);

                            const fileName = nativeFile.name.replace(/\.(zip|mcpb)$/i, '');
                            form.setFieldsValue({ name: fileName });

                            // 分析文件类型并设置标签（仅在新创建时）
                            if (!server) {
                                const fileTags = analyzeFileTags([{ name: nativeFile.name }]);
                                setTags(fileTags);
                            }

                            return false;
                        }}
                        onRemove={() => {
                            setFileList([]);
                            if (!server) {
                                setTags(['stdio']);
                            }
                        }}
                        maxCount={1}
                    >
                        <Button icon={<UploadOutlined />}>选择 ZIP 包</Button>
                    </Upload>
                ) : (
                    <div>
                        <Button
                            icon={<FolderOpenOutlined />}
                            loading={isOpeningDialog}
                            disabled={isOpeningDialog}
                            onClick={() => {
                                setIsOpeningDialog(true);

                                // 使用setTimeout让UI有时间更新，显示加载状态
                                setTimeout(() => {
                                    // 动态创建input元素
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;width:1px;height:1px;pointer-events:none;';
                                    input.setAttribute('webkitdirectory', '');
                                    input.setAttribute('directory', '');
                                    input.multiple = true;

                                    input.onchange = (e) => {
                                        const nativeFiles = Array.from((e.target as HTMLInputElement).files || []);

                                        if (nativeFiles.length > 0) {
                                            const firstRelativePath = nativeFiles[0].webkitRelativePath || '';
                                            const folderName = firstRelativePath.split(/[/\\]/)[0] || 'mcp_server';

                                            form.setFieldsValue({ name: folderName });
                                        }

                                        const mappedFiles = nativeFiles.map(f => ({
                                            uid: `${f.name}-${Date.now()}`,
                                            name: f.webkitRelativePath || f.name,
                                            status: 'done' as const,
                                            originFileObj: f,
                                        }));

                                        setFileList(mappedFiles);

                                        // 分析文件类型并设置标签（仅在新创建时）
                                        if (!server) {
                                            const fileTags = analyzeFileTags(mappedFiles);
                                            setTags(fileTags);
                                        }

                                        // 清理DOM
                                        if (input.parentNode) {
                                            document.body.removeChild(input);
                                        }
                                        setIsOpeningDialog(false);
                                    };

                                    // 处理用户取消选择的情况
                                    const handleWindowFocus = () => {
                                        setTimeout(() => {
                                            if (input.parentNode) {
                                                document.body.removeChild(input);
                                            }
                                            setIsOpeningDialog(false);
                                            window.removeEventListener('focus', handleWindowFocus);
                                        }, 300);
                                    };
                                    window.addEventListener('focus', handleWindowFocus);

                                    // 添加到DOM并触发点击
                                    document.body.appendChild(input);

                                    // 使用requestAnimationFrame确保DOM更新完成后再触发点击
                                    requestAnimationFrame(() => {
                                        input.click();
                                    });
                                }, 100); // 100ms延迟确保UI更新和浏览器主线程空闲
                            }}
                        >
                            {isOpeningDialog ? '正在打开...' : '选择文件夹'}
                        </Button>
                        {fileList.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                                <span>已选择 {fileList.length} 个文件</span>
                            </div>
                        )}
                    </div>
                )}
            </Card>
        );
    };

    const renderHttpConfig = () => (
        <Card title="HTTP 连接配置" size="small" style={{ marginBottom: 16 }}>
            <Form.Item
                label="服务器 URL"
                name="url"
                rules={[{ required: true, message: '请输入服务器 URL' }]}
            >
                <Input placeholder="例如: http://localhost:3000/mcp" />
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

            <Form.Item label="会话ID" name="session_id">
                <Input placeholder="可选，用于持久会话" />
            </Form.Item>
        </Card>
    );

    const renderSseConfig = () => (
        <Card title="SSE 连接配置" size="small" style={{ marginBottom: 16 }}>
            <Form.Item
                label="服务器 URL"
                name="url"
                rules={[{ required: true, message: '请输入服务器 URL' }]}
            >
                <Input placeholder="例如: http://localhost:3000" />
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

            <Row gutter={16}>
                <Col span={12}>
                    <Form.Item label="SSE 端点" name="sse_endpoint">
                        <Input placeholder="/sse" />
                    </Form.Item>
                </Col>
                <Col span={12}>
                    <Form.Item label="自动重连" name="reconnect" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Col>
            </Row>

            <Row gutter={16}>
                <Col span={12}>
                    <Form.Item label="重试间隔(秒)" name="retry_interval">
                        <InputNumber min={1} max={60} style={{ width: '100%' }} />
                    </Form.Item>
                </Col>
                <Col span={12}>
                    <Form.Item label="最大重试次数" name="max_retries">
                        <InputNumber min={1} max={10} style={{ width: '100%' }} />
                    </Form.Item>
                </Col>
            </Row>
        </Card>
    );

    const renderToolsList = () => {
        const enabledCount = tools.filter(t => t.is_enabled !== false).length;

        return (
            <Card
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ToolOutlined />
                            <span>工具列表</span>
                            {tools.length > 0 && (
                                <Tag color="blue">{enabledCount}/{tools.length} 启用</Tag>
                            )}
                        </div>
                        <Button
                            type="primary"
                            size="small"
                            onClick={handleConnectAndLoadTools}
                            loading={connecting}
                        >
                            连接
                        </Button>
                    </div>
                }
                size="small"
                style={{ marginBottom: 16 }}
            >
                {tools.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#999' }}>
                        暂无工具，点击"连接"按钮获取工具列表
                    </div>
                ) : (
                    <List
                        size="small"
                        dataSource={tools}
                        renderItem={(tool) => (
                            <List.Item
                                actions={[
                                    <Switch
                                        size="small"
                                        checked={tool.is_enabled !== false}
                                        onChange={(checked) => handleToolEnabledChange(tool.name, checked)}
                                    />
                                ]}
                            >
                                <List.Item.Meta
                                    title={
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span>{tool.name}</span>
                                            {tool.is_enabled === false && (
                                                <Tag color="default">已禁用</Tag>
                                            )}
                                        </div>
                                    }
                                    description={
                                        <Tooltip title={tool.description}>
                                            <span style={{
                                                color: 'var(--text-secondary)',
                                                fontSize: 12,
                                                display: 'block',
                                                maxWidth: 400,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {tool.description || '无描述'}
                                            </span>
                                        </Tooltip>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                )}
            </Card>
        );
    };

    const renderOtherConfig = () => (
        <Card title="其他配置" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
                <Col span={8}>
                    <Form.Item
                        label="超时时间（秒）"
                        name="timeout"
                        rules={[{ required: true, message: '请输入超时时间' }]}
                    >
                        <InputNumber min={1} max={300} style={{ width: '100%' }} />
                    </Form.Item>
                </Col>
                <Col span={8}>
                    <Form.Item label="启用" name="enabled" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Col>
                <Col span={8}>
                    <Form.Item label="共享" name="share" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Col>
            </Row>
        </Card>
    );

    return (
        <Modal
            title={server ? '编辑 MCP' : '新建 MCP'}
            open={visible}
            onCancel={onClose}
            onOk={handleSave}
            okText="保存"
            cancelText="取消"
            confirmLoading={saving}
            width={900}
        >
            <Form form={form} layout="vertical">
                {renderCreateTypeSelector()}
                {renderBasicInfo()}
                
                {createType === 'python' && renderPythonConfig()}
                {createType === 'stdio' && renderStdioConfig()}
                {createType === 'http' && renderHttpConfig()}
                {createType === 'sse' && renderSseConfig()}

                {/* 显示工具列表（编辑模式下） */}
                {renderToolsList()}

                {renderOtherConfig()}
            </Form>
        </Modal>
    );
};

export default MCPAddServerModal;
