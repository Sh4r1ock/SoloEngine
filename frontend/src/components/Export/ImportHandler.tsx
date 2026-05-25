import React, { useState, useRef } from 'react';
import { Upload, Button, App, Space, Typography, Card, Alert } from 'antd';
import { UploadOutlined, InboxOutlined, FileTextOutlined } from '@ant-design/icons';
import { api } from '../../services/api';

const { Dragger } = Upload;
const { Text, Title } = Typography;

interface ImportHandlerProps {
  onImport: () => void;
}

const ImportHandler: React.FC<ImportHandlerProps> = ({ onImport }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const handleImport = async (file: File) => {
    setLoading(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/export/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.code === 200) {
        setImportResult(response.data);
        message.success('导入成功');
        onImport();
      } else {
        message.error('导入失败：' + response.message);
      }
    } catch (error) {
      message.error('导入失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const uploadProps = {
    name: 'file',
    multiple: false,
    accept: '.json,.zip',
    showUploadList: false,
    beforeUpload: (file: File) => {
      handleImport(file);
      return false;
    },
  };

  return (
    <div style={{ padding: '24px' }}>
      <Title level={4}>导入项目</Title>
      
      <Card style={{ marginTop: 16 }}>
        <Dragger {...uploadProps} disabled={loading}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域</p>
          <p className="ant-upload-hint">
            支持 JSON 或 ZIP 格式的项目文件
          </p>
        </Dragger>
      </Card>

      {importResult && (
        <Card style={{ marginTop: 16 }}>
          <Alert
            message="导入成功"
            description={
              <Space direction="vertical">
                <Text>项目名称: {importResult.project_name}</Text>
                <Text>节点数量: {importResult.nodes_count}</Text>
                <Text>连线数量: {importResult.edges_count}</Text>
              </Space>
            }
            type="success"
            showIcon
          />
        </Card>
      )}
    </div>
  );
};

export default ImportHandler;
