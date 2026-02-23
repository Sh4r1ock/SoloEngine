import React, { useState } from 'react';
import { Card, Form, Input, Select, Switch, Button, Space, Divider, InputNumber } from 'antd';
import { SaveOutlined } from '@ant-design/icons';

interface PackageSettingsProps {
  onSave?: (settings: any) => void;
  initialValues?: any;
}

const PackageSettings: React.FC<PackageSettingsProps> = ({
  onSave,
  initialValues,
}) => {
  const [form] = Form.useForm();

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      onSave?.(values);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  return (
    <Card title="打包设置">
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          includeDockerfile: true,
          includeReadme: true,
          includeCompose: true,
          compressLevel: 6,
          ...initialValues,
        }}
      >
        <Form.Item
          name="includeDockerfile"
          label="生成 Dockerfile"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="includeReadme"
          label="生成 README"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="includeCompose"
          label="生成 docker-compose.yml"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="compressLevel"
          label="压缩级别"
        >
          <Select>
            <Select.Option value={1}>1 - 最快</Select.Option>
            <Select.Option value={6}>6 - 默认</Select.Option>
            <Select.Option value={9}>9 - 最高压缩</Select.Option>
          </Select>
        </Form.Item>

        <Divider />

        <Form.Item
          name="excludes"
          label="排除文件 (每行一个模式)"
        >
          <Input.TextArea
            rows={4}
            placeholder="*.log&#10;.git&#10;__pycache__&#10;node_modules"
          />
        </Form.Item>

        <Form.Item>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
            保存设置
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default PackageSettings;
