import React, { useState } from 'react';
import { Modal, Upload, message, Space, Typography, List, Card, Divider } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { skillsApi } from '../../services/skillsApi';

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface SkillsImportDialogProps {
  visible: boolean;
  onClose: () => void;
  onImport: () => void;
}

const SkillsImportDialog: React.FC<SkillsImportDialogProps> = ({ visible, onClose, onImport }) => {
  const [importing, setImporting] = useState(false);

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const response = await skillsApi.importPackage(file);
      if (response.code === 200) {
        message.success('Skills 包导入成功！');
        onImport();
        onClose();
      } else {
        message.error('导入失败：' + response.message);
      }
    } catch (error) {
      message.error('导入失败：' + String(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title="导入 Skills 包"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={5}>支持的格式</Title>
          <List
            dataSource={[
              { icon: '📦', name: 'ZIP 文件', desc: '.zip 格式的 Skills 包压缩文件' },
              { icon: '📁', name: '文件夹', desc: '包含 SKILL.md 的文件夹结构' },
            ]}
            renderItem={(item) => (
              <List.Item>
                <Space>
                  <span style={{ fontSize: 24 }}>{item.icon}</span>
                  <div>
                    <Text strong>{item.name}</Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.desc}
                      </Text>
                    </div>
                  </div>
                </Space>
              </List.Item>
            )}
          />
        </div>

        <Divider />

        <Dragger
          name="file"
          multiple={false}
          accept=".zip"
          customRequest={({ file, onSuccess, onError }) => {
            handleImport(file as File)
              .then(() => {
                if (onSuccess) onSuccess(file);
              })
              .catch((err) => {
                if (onError) onError(err);
              });
          }}
          disabled={importing}
          showUploadList={false}
        >
          <div style={{ padding: '40px 0' }}>
            <InboxOutlined style={{ fontSize: 64, color: '#1890ff' }} />
            <div style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 16 }}>
                点击或拖拽文件到此区域上传
              </Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">
                支持 .zip 格式的 Skills 包
              </Text>
            </div>
          </div>
        </Dragger>

        <Card size="small" style={{ background: '#f5f5f5' }}>
          <Text style={{ fontSize: 12 }}>
            💡 提示：Skills 包应该包含 SKILL.md 文件和 skills/、common/ 等标准目录结构。
          </Text>
        </Card>
      </Space>
    </Modal>
  );
};

export default SkillsImportDialog;
