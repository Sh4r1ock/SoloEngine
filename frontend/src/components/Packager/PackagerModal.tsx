import React, { useState } from 'react';
import { Modal, Form, Input, Select, Button, Space, App, Divider, Switch, InputNumber } from 'antd';
import { DownloadOutlined, AppstoreOutlined } from '@ant-design/icons';
import { api } from '../../services/api';

interface PackagerModalProps {
  visible: boolean;
  projectName: string;
  onClose: () => void;
  onPackage: () => void;
}

const PackagerModal: React.FC<PackagerModalProps> = ({
  visible,
  projectName,
  onClose,
  onPackage,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [packageResult, setPackageResult] = useState<any>(null);

  const handlePackage = async (values: any) => {
    setLoading(true);
    try {
      const response = await api.post('/package/create', {
        project_name: projectName,
        name: values.name || projectName,
        version: values.version,
        description: values.description,
        author: values.author,
        entry_point: values.entryPoint,
        runtime: values.runtime,
        dependencies: values.dependencies?.split('\n').filter((d: string) => d.trim()) || [],
        environment_vars: {},
      });

      if (response.code === 200) {
        setPackageResult(response.data);
        message.success('打包成功');
        onPackage();
      } else {
        message.error('打包失败：' + response.message);
      }
    } catch (error) {
      message.error('打包失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!packageResult) return;

    try {
      const response = await api.get(`/package/${packageResult.name}/download`, {
        responseType: 'blob',
      });

      const blob = new Blob([response as unknown as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${packageResult.name}-${packageResult.version}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error('下载失败：' + String(error));
    }
  };

  return (
    <Modal
      title="打包项目"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      {packageResult ? (
        <div style={{ padding: '16px 0' }}>
          <p>打包成功！</p>
          <p>包名称: {packageResult.name}</p>
          <p>版本: {packageResult.version}</p>
          <p>文件数量: {packageResult.files_count}</p>
          <p>大小: {(packageResult.size_bytes / 1024).toFixed(2)} KB</p>
          <Space>
            <Button onClick={() => setPackageResult(null)}>重新打包</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
              下载包
            </Button>
          </Space>
        </div>
      ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            version: '1.0.0',
            entryPoint: 'main',
            runtime: 'python',
          }}
          onFinish={handlePackage}
        >
          <Form.Item
            name="name"
            label="包名称"
          >
            <Input placeholder={projectName} />
          </Form.Item>

          <Form.Item
            name="version"
            label="版本"
            rules={[{ required: true }]}
          >
            <Input placeholder="1.0.0" />
          </Form.Item>

          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea rows={2} placeholder="项目描述" />
          </Form.Item>

          <Form.Item
            name="author"
            label="作者"
          >
            <Input placeholder="作者名称" />
          </Form.Item>

          <Form.Item
            name="entryPoint"
            label="入口文件"
          >
            <Input placeholder="main" />
          </Form.Item>

          <Form.Item
            name="runtime"
            label="运行时"
          >
            <Select>
              <Select.Option value="python">Python</Select.Option>
              <Select.Option value="node">Node.js</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="dependencies"
            label="依赖 (每行一个)"
          >
            <Input.TextArea
              rows={4}
              placeholder="fastapi&#10;uvicorn&#10;httpx"
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                htmlType="submit"
                icon={<AppstoreOutlined />}
                loading={loading}
              >
                创建包
              </Button>
            </Space>
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

export default PackagerModal;
