import React, { useState } from 'react';
import { Modal, Form, Input, Select, Button, Space, message, Divider, Switch } from 'antd';
import { DownloadOutlined, UploadOutlined, FileZipOutlined } from '@ant-design/icons';
import { api } from '../../services/api';

interface ExportModalProps {
  visible: boolean;
  projectName: string;
  onClose: () => void;
  onExport: () => void;
}

const ExportModal: React.FC<ExportModalProps> = ({
  visible,
  projectName,
  onClose,
  onExport,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleExport = async (values: any) => {
    setLoading(true);
    try {
      const response = await api.get(`/export/project/${projectName}`, {
        params: {
          format: values.format,
          include_history: values.includeHistory,
          include_skills: values.includeSkills,
          include_mcp_config: values.includeMcpConfig,
        },
        responseType: values.format === 'zip' ? 'blob' : 'json',
      });

      if (values.format === 'zip') {
        const blob = new Blob([response as unknown as BlobPart], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${projectName}.zip`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(response, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${projectName}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }

      message.success('导出成功');
      onExport();
      onClose();
    } catch (error) {
      message.error('导出失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="导出项目"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={500}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          format: 'json',
          includeHistory: false,
          includeSkills: true,
          includeMcpConfig: true,
        }}
        onFinish={handleExport}
      >
        <Form.Item
          name="format"
          label="导出格式"
        >
          <Select>
            <Select.Option value="json">
              <Space>
                <FileZipOutlined />
                JSON 格式
              </Space>
            </Select.Option>
            <Select.Option value="zip">
              <Space>
                <FileZipOutlined />
                ZIP 压缩包
              </Space>
            </Select.Option>
          </Select>
        </Form.Item>

        <Divider>导出选项</Divider>

        <Form.Item
          name="includeHistory"
          label="包含执行历史"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="includeSkills"
          label="包含 Skills 包"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="includeMcpConfig"
          label="包含 MCP 配置"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              htmlType="submit"
              icon={<DownloadOutlined />}
              loading={loading}
            >
              导出
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ExportModal;
