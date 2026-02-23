import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, message, Alert } from 'antd';
import { skillsApi } from '../../services/skillsApi';
import { useAuthStore } from '../../store/authStore';

interface SkillsCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: () => void;
}

const defaultSkillTemplate = `# Skills 包说明

## 描述
简要描述这个 Skills 包的功能和用途。

## 使用场景
- 场景1：描述
- 场景2：描述

## 最佳实践
1. 实践建议1
2. 实践建议2

## 示例
提供一些使用示例...
`;

const SkillsCreateModal: React.FC<SkillsCreateModalProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const { user } = useAuthStore();

  useEffect(() => {
    if (visible) {
      form.resetFields();
      if (user?.username) {
        form.setFieldsValue({ author: user.username });
      }
    }
  }, [visible, form, user]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);

      const request = {
        name: values.name,
        description: values.description || '',
        author: values.author || '',
        tags: values.tags ? values.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t) : [],
      };

      const response = await skillsApi.createPackage(request);
      if (response.code === 200) {
        message.success('Skills 包创建成功！');
        onSave();
      } else {
        message.error('创建失败：' + response.message);
      }
    } catch (error) {
      message.error('创建失败：' + String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title="创建 Skills 包"
      open={visible}
      onCancel={onClose}
      onOk={handleCreate}
      okText="创建"
      cancelText="取消"
      confirmLoading={creating}
      width={600}
    >
      <Alert
        message="Skills 包结构说明"
        description={
          <div>
            <p style={{ margin: '0 0 8px 0' }}>Skills 包应包含 <strong>SKILL.md</strong> 文件和 <strong>skills/</strong> 等标准目录结构。</p>
            <p style={{ margin: '0 0 8px 0' }}>创建后，系统会自动生成以下默认结构：</p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li><code>SKILL.md</code> - 技能说明文档（必需）</li>
              <li><code>skills/</code> - 技能脚本目录</li>
              <li><code>templates/</code> - 模板文件目录</li>
              <li><code>resources/</code> - 资源文件目录</li>
            </ul>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item
          label="包名称"
          name="name"
          rules={[
            { required: true, message: '请输入包名称' },
            { pattern: /^[a-zA-Z0-9_-]+$/, message: '只能包含字母、数字、下划线和连字符' },
          ]}
        >
          <Input placeholder="例如: coding-assistant" />
        </Form.Item>

        <Form.Item
          label="描述"
          name="description"
        >
          <Input.TextArea
            rows={3}
            placeholder="描述这个 Skills 包的功能..."
          />
        </Form.Item>

        <Form.Item
          label="作者"
          name="author"
        >
          <Input placeholder="作者名称" />
        </Form.Item>

        <Form.Item
          label="标签"
          name="tags"
        >
          <Input placeholder="用逗号分隔，例如: coding, assistant, productivity" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SkillsCreateModal;
