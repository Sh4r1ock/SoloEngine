import React, { useEffect, useState, useRef } from 'react';
import { Modal, Form, Input, Select, InputNumber, Switch, message, Button, Divider, Alert, Card, Row, Col, Tag, Tabs, Upload, Radio } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, FolderOpenOutlined, FileZipOutlined, ApiOutlined, CloudServerOutlined, CodeOutlined } from '@ant-design/icons';
import { MCPServer } from '../../services/mcpApi';
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
    const [form] = Form.useForm();
    const [saving, setSaving] = useState(false);
    const [createType, setCreateType] = useState<CreateType>('python');
    const [inputParams, setInputParams] = useState<ParameterConfig[]>([]);
    const [pythonCode, setPythonCode] = useState(defaultPythonTemplate);
    const [stdioUploadType, setStdioUploadType] = useState<'zip' | 'folder'>('zip');
    const [fileList, setFileList] = useState<any[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [inputTagValue, setInputTagValue] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (visible) {
            if (server) {
                form.setFieldsValue({
                    name: server.name,
                    description: server.description || '',
                    timeout: server.timeout || 30,
                    enabled: server.enabled !== false,
                    share: server.share || false,
                });
                
                // 加载标签
                setTags(server.tags || []);
                
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
                    enabled: true,
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
                    
                    // 更新基本信息（描述和标签）
                    const baseInfoResponse = await mcpApi.updateServer(server.id, {
                        description: values.description,
                        tags: tags,
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
                // 判断是更新还是创建
                if (server) {
                    // 更新现有 Stdio MCP 的基本信息
                    const response = await mcpApi.updateServer(server.id, {
                        description: values.description,
                        tags: tags,
                    });
                    
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
                        enabled: values.enabled,
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
                        enabled: values.enabled,
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
                        enabled: values.enabled,
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
                        enabled: values.enabled,
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
                                    color={index < 2 ? 'blue' : 'default'}
                                    style={{ 
                                        margin: 0,
                                        padding: '0 7px',
                                        fontSize: 14,
                                        lineHeight: '20px',
                                        borderRadius: 4,
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

    const renderStdioConfig = () => (
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
                        const nativeFile = file.originFileObj || file;

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
                    <input
                        type="file"
                        ref={fileInputRef}
                        multiple
                        webkitdirectory=""
                        directory=""
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const nativeFiles = Array.from(e.target.files || []);

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
                        }}
                    />
                    <Button icon={<FolderOpenOutlined />} onClick={() => fileInputRef.current?.click()}>
                        选择文件夹
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
                
                {renderOtherConfig()}
            </Form>
        </Modal>
    );
};

export default MCPAddServerModal;
