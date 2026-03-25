import React, { useCallback } from 'react';
import { Typography, Button } from 'antd';
import { FileUnknownOutlined, DownloadOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';

const { Text } = Typography;

interface UnsupportedViewerProps {
  instanceId: string;
  tab: FileTab;
}

const UnsupportedViewer: React.FC<UnsupportedViewerProps> = ({ tab }) => {
  const ext = tab.name.split('.').pop()?.toLowerCase() || 'unknown';

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    if (tab.content.startsWith('data:')) {
      link.href = tab.content;
    } else {
      link.href = `data:application/octet-stream;base64,${tab.content}`;
    }
    link.download = tab.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [tab]);

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'var(--bg-100)',
      padding: 32,
    }}>
      <FileUnknownOutlined style={{ fontSize: 64, color: 'var(--text-300)', marginBottom: 24 }} />
      <Text style={{ fontSize: 16, color: 'var(--text-200)', marginBottom: 8 }}>
        不支持的文件类型
      </Text>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
        文件名: {tab.name}
      </Text>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
        扩展名: .{ext}
      </Text>
      <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', maxWidth: 400, marginBottom: 24 }}>
        当前版本暂不支持预览此类型文件。您可以下载后使用本地应用程序打开。
      </Text>
      <Button 
        type="primary" 
        icon={<DownloadOutlined />}
        onClick={handleDownload}
      >
        下载文件
      </Button>
    </div>
  );
};

export default UnsupportedViewer;
