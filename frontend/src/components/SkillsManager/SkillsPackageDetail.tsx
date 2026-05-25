import React from 'react';
import { Modal, Typography, Tag, Divider, Space, Button } from 'antd';
import { FolderOpenOutlined, EditOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { SkillsPackage } from '../../services/skillsApi';

const { Title, Paragraph, Text } = Typography;

interface SkillsPackageDetailProps {
  visible: boolean;
  package: SkillsPackage;
  onClose: () => void;
  onEdit?: () => void;
}

const SkillsPackageDetail: React.FC<SkillsPackageDetailProps> = ({
  visible,
  package: pkg,
  onClose,
  onEdit,
}) => {
  return (
    <Modal
      title={
        <Space>
          <FolderOpenOutlined style={{ color: 'var(--primary-100)' }} />
          <span>{pkg.name}</span>
          {pkg.is_active && (
            <Tag color="success" icon={<CheckCircleOutlined />}>已激活</Tag>
          )}
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          {onEdit && (
            <Button type="primary" icon={<EditOutlined />} onClick={onEdit}>
              编辑
            </Button>
          )}
        </Space>
      }
      width={700}
    >
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">描述</Text>
        <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
          {pkg.description || pkg.metadata?.description || '暂无描述'}
        </Paragraph>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 24 }}>
        <div>
          <Text type="secondary">版本</Text>
          <div><Text strong>{pkg.metadata?.version || pkg.pkg_version || '1.0.0'}</Text></div>
        </div>
        <div>
          <Text type="secondary">作者</Text>
          <div><Text strong>{pkg.metadata?.author || pkg.author || '未知'}</Text></div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">标签</Text>
        <div style={{ marginTop: 8 }}>
          {(pkg.metadata?.tags || pkg.tags || []).length > 0 ? (
            (pkg.metadata?.tags || pkg.tags || []).map((tag: string, index: number) => (
              <Tag 
                key={index} 
                style={{ 
                  marginBottom: 4,
                  backgroundColor: tag === 'system' ? 'var(--primary-300)' : undefined,
                  border: tag === 'system' ? '1px solid var(--primary-100)' : undefined,
                  color: tag === 'system' ? 'var(--primary-100)' : undefined,
                }}
              >
                {tag}
              </Tag>
            ))
          ) : (
            <Text type="secondary">无标签</Text>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">路径</Text>
        <div style={{ marginTop: 8 }}>
          <Text code style={{ fontSize: 12 }}>
            {pkg.folder_path || 'N/A'}
          </Text>
        </div>
      </div>

      {pkg.skills && pkg.skills.length > 0 && (
        <>
          <Divider>技能文件</Divider>
          <div style={{ maxHeight: '200px', overflow: 'auto' }}>
            {pkg.skills.map((skill, index) => (
              <div key={index} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color-light)' }}>
                <Text strong>{skill.name}</Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>({skill.type})</Text>
              </div>
            ))}
          </div>
        </>
      )}

    </Modal>
  );
};

export default SkillsPackageDetail;
