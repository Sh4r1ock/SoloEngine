import React, { useEffect } from 'react';
import { Modal, Form, Button, Space, Typography, Divider, Tabs } from 'antd';
import { useCanvasStore, GlobalSettings } from '../../store/canvasStore';
import LLMConfig from './LLMConfig';
import TimezoneSettings from './TimezoneSettings';

const { Text } = Typography;

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose }) => {
  const { globalSettings, setGlobalSettings } = useCanvasStore();
  const [form] = Form.useForm<GlobalSettings>();

  useEffect(() => {
    if (visible) {
      form.setFieldsValue(globalSettings);
    }
  }, [visible, globalSettings, form]);

  const handleSave = async () => {
    const values = await form.validateFields();
    setGlobalSettings(values);
    onClose();
  };

  return (
    <Modal
      title="设置"
      open={visible}
      onCancel={onClose}
      width={1000}
      footer={null}
      style={{ top: 20 }}
    >
      <Tabs
        defaultActiveKey="global"
        items={[
          {
            key: 'global',
            label: '全局设置',
            children: (
              <div style={{ padding: '16px 0' }}>
                <Form form={form} layout="vertical">
                  <Form.Item
                    label="最大上下文长度"
                    name="maxContextLength"
                    rules={[{ required: true }]}
                  >
                    <Text style={{ fontSize: 12, color: '#000000a6' }}>
                      4096
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: '#00000073' }}>
                        Agentic 单次执行的最大上下文长度（token 数）
                      </Text>
                    </div>
                  </Form.Item>

                  <Form.Item
                    label="最大循环次数"
                    name="maxIterations"
                    rules={[{ required: true }]}
                  >
                    <Text style={{ fontSize: 12, color: '#000000a6' }}>
                      10
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: '#00000073' }}>
                        Agentic 执行的最大循环次数
                      </Text>
                    </div>
                  </Form.Item>

                  <Form.Item
                    label="超时时间（秒）"
                    name="timeout"
                    rules={[{ required: true }]}
                  >
                    <Text style={{ fontSize: 12, color: '#000000a6' }}>
                      300
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: '#00000073' }}>
                        单个 Agent 执行的超时时间
                      </Text>
                    </div>
                  </Form.Item>

                  <Divider style={{ margin: '24px 0 16px 0' }}>Agentic 配置</Divider>

                  <Form.Item
                    label="最大上下文长度"
                    name="maxContextLength"
                    rules={[{ required: true }]}
                  >
                    <Text style={{ fontSize: 12, color: '#000000a6' }}>
                      4096
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: '#00000073' }}>
                        Agentic 单次执行的最大上下文长度（token 数）
                      </Text>
                    </div>
                  </Form.Item>

                  <Form.Item
                    label="最大循环次数"
                    name="maxIterations"
                    rules={[{ required: true }]}
                  >
                    <Text style={{ fontSize: 12, color: '#000000a6' }}>
                      10
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: '#00000073' }}>
                        Agentic 执行的最大循环次数
                      </Text>
                    </div>
                  </Form.Item>

                  <Form.Item
                    label="超时时间（秒）"
                    name="timeout"
                    rules={[{ required: true }]}
                  >
                    <Text style={{ fontSize: 12, color: '#000000a6' }}>
                      300
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: '#00000073' }}>
                        Agentic 执行的超时时间
                      </Text>
                    </div>
                  </Form.Item>

                  <Space style={{ marginTop: 24 }}>
                    <Button onClick={onClose}>关闭</Button>
                    <Button type="primary" onClick={handleSave}>
                      保存全局设置
                    </Button>
                  </Space>
                </Form>
              </div>
            ),
          },
          {
            key: 'llm',
            label: 'LLM 配置',
            children: (
              <div style={{ padding: '16px 0' }}>
                <LLMConfig />
              </div>
            ),
          },
          {
            key: 'timezone',
            label: '时区设置',
            children: (
              <div style={{ padding: '16px 0' }}>
                <TimezoneSettings />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};

export default SettingsModal;
