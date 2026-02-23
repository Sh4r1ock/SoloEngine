import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, InputNumber, Switch, message, Button, Divider, Space, Alert } from 'antd';
import { MCPServer } from '../../services/mcpApi';
import { mcpApi } from '../../services/mcpApi';

const { Option } = Select;
const { TextArea } = Input;

const defaultPythonTemplate = `# MCP 工具定义
# 用户只需要定义 main() 函数和 return_tools() 函数

def main():
    """
    MCP 主入口函数
    在这里编写您的工具逻辑
    """
    pass


def return_tools():
    """
    返回工具定义
    定义您的MCP工具列表
    """
    return {
        "tools": [
            {
                "name": "my_tool",
                "description": "工具描述",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "param1": {
                            "type": "string",
                            "description": "参数1描述"
                        }
                    },
                    "required": ["param1"]
                }
            }
        ]
    }


if __name__ == "__main__":
    main()
`;

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
  const [transportType, setTransportType] = useState<string>('http');

  useEffect(() => {
    if (visible) {
      if (server) {
        form.setFieldsValue({
          name: server.name,
          transport: server.transport,
          url: server.url,
          command: server.command,
          args: server.args ? server.args.join('\n') : '',
          env: server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
          headers: server.headers ? Object.entries(server.headers).map(([k, v]) => `${k}=${v}`).join('\n') : '',
          timeout: server.timeout || 30,
          enabled: server.enabled !== false,
          pythonCode: server.python_code || defaultPythonTemplate,
        });
        setTransportType(server.transport || 'http');
      } else {
        form.resetFields();
        form.setFieldsValue({
          transport: 'python',
          timeout: 30,
          enabled: true,
          pythonCode: defaultPythonTemplate,
        });
        setTransportType('python');
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
        config.python_code = values.pythonCode;
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
        config.python_code = values.pythonCode;
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
      width={800}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="工具名称"
          name="name"
          rules={[{ required: true, message: '请输入工具名称' }]}
        >
          <Input placeholder="例如: My Custom Tool" />
        </Form.Item>

        <Form.Item
          label="传输类型"
          name="transport"
          rules={[{ required: true, message: '请选择传输类型' }]}
        >
          <Select onChange={handleTransportChange}>
            <Option value="python">自定义 Python MCP</Option>
            <Option value="stdio">Stdio (本地进程)</Option>
            <Option value="http">HTTP</Option>
            <Option value="sse">SSE (Server-Sent Events)</Option>
          </Select>
        </Form.Item>

        {transportType === 'python' && (
          <>
            <Alert
              message="自定义 MCP 工具"
              description="编写 Python 代码定义您的 MCP 工具。只需实现 main() 函数和 return_tools() 函数，系统会自动封装 MCP 服务器框架。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              label="Python 代码"
              name="pythonCode"
              rules={[{ required: true, message: '请输入 Python 代码' }]}
            >
              <TextArea
                rows={20}
                style={{
                  fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", "Monaco", monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                  backgroundColor: '#1e1e1e',
                  color: '#d4d4d4',
                  borderRadius: 8,
                  border: '1px solid #333',
                  padding: '16px',
                  tabSize: 4,
                }}
                spellCheck={false}
                placeholder={defaultPythonTemplate}
              />
            </Form.Item>
          </>
        )}

        {(transportType === 'http' || transportType === 'sse') && (
          <>
            <Form.Item
              label="服务器 URL"
              name="url"
              rules={[
                { required: true, message: '请输入服务器 URL' },
              ]}
            >
              <Input placeholder="例如: https://api.example.com/mcp" />
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
          </>
        )}

        {transportType === 'stdio' && (
          <>
            <Form.Item
              label="命令"
              name="command"
              rules={[{ required: true, message: '请输入命令' }]}
            >
              <Input placeholder="例如: npx -y @modelcontextprotocol/server-filesystem" />
            </Form.Item>

            <Form.Item
              label="参数"
              name="args"
              extra="每行一个参数"
            >
              <TextArea
                rows={3}
                placeholder="/path/to/directory&#10;--option&#10;value"
              />
            </Form.Item>

            <Form.Item
              label="环境变量"
              name="env"
              extra="每行一个，格式: key=value"
            >
              <TextArea
                rows={3}
                placeholder="API_KEY=xxx&#10;DEBUG=true"
              />
            </Form.Item>
          </>
        )}

        <Form.Item
          label="超时时间（秒）"
          name="timeout"
          rules={[{ required: true, message: '请输入超时时间' }]}
        >
          <InputNumber min={1} max={300} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          label="启用"
          name="enabled"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Divider />

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
