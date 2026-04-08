import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, message, Alert, Tag } from 'antd';
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
  const [tags, setTags] = useState<string[]>([]);
  const [inputTagValue, setInputTagValue] = useState('');

  useEffect(() => {
    if (visible) {
      form.resetFields();
      setTags([]);
      setInputTagValue('');
      if (user?.username) {
        form.setFieldsValue({ author: user.username });
      }
    }
  }, [visible, form, user]);

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

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);

      const request = {
        name: values.name,
        description: values.description || '',
        author: values.author || '',
        tags: tags,
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
      </Form>
    </Modal>
  );
};

export default SkillsCreateModal;
