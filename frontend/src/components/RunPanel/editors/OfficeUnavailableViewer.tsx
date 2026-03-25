import React, { useCallback } from 'react';
import { Result, Button, Typography, Collapse } from 'antd';
import { DownloadOutlined, SettingOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';

const { Paragraph, Text } = Typography;

interface OfficeUnavailableViewerProps {
  instanceId: string;
  tab: FileTab;
  reason?: 'onlyoffice_required' | 'fallback_unavailable';
}

const OfficeUnavailableViewer: React.FC<OfficeUnavailableViewerProps> = ({ tab, reason = 'onlyoffice_required' }) => {
  const ext = tab.name.split('.').pop()?.toLowerCase();

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

  const deploymentGuide = (
    <Collapse
      items={[
        {
          key: '1',
          label: 'OnlyOffice 部署指南',
          children: (
            <div>
              <Paragraph><Text strong>Docker 部署（推荐）：</Text></Paragraph>
              <pre style={{ 
                background: '#1e1e1e', 
                color: '#d4d4d4', 
                padding: 12, 
                borderRadius: 4,
                overflow: 'auto',
                fontSize: 12,
              }}>
{`docker run -i -t -d -p 8080:80 \\
  --restart=always \\
  -v /app/onlyoffice/DocumentServer/logs:/var/log/onlyoffice \\
  -v /app/onlyoffice/DocumentServer/data:/var/www/onlyoffice/Data \\
  -v /app/onlyoffice/DocumentServer/lib:/var/lib/onlyoffice \\
  -v /app/onlyoffice/DocumentServer/db:/var/lib/postgresql \\
  onlyoffice/documentserver`}
              </pre>
              <Paragraph style={{ marginTop: 12 }}>
                <Text strong>配置文件 (.env)：</Text>
              </Paragraph>
              <pre style={{ 
                background: '#1e1e1e', 
                color: '#d4d4d4', 
                padding: 12, 
                borderRadius: 4,
                fontSize: 12,
              }}>
{`ONLYOFFICE_URL=http://localhost:8080
ONLYOFFICE_ENABLED=true`}
              </pre>
            </div>
          ),
        },
      ]}
    />
  );

  const messages = {
    onlyoffice_required: {
      title: '需要部署 OnlyOffice 服务',
      description: (
        <>
          <Paragraph>
            当前文件类型 <Text strong>.{ext}</Text> 需要 OnlyOffice 服务才能在线编辑和显示变更记录。
          </Paragraph>
          <Paragraph>
            部署 OnlyOffice 后，您可以：
          </Paragraph>
          <ul>
            <li>在线编辑 Word、Excel、PowerPoint 文档</li>
            <li>查看 Agent 修改的变更记录（修订模式）</li>
            <li>选择文档内容让 Agent 进行精确修改</li>
          </ul>
        </>
      ),
    },
    fallback_unavailable: {
      title: '无法预览此文件',
      description: (
        <>
          <Paragraph>
            当前文件类型 <Text strong>.{ext}</Text> 无法在浏览器中预览。
          </Paragraph>
          <Paragraph>
            建议您：
          </Paragraph>
          <ul>
            <li>部署 OnlyOffice 服务以支持在线编辑</li>
            <li>下载文件到本地使用 Office 软件打开</li>
          </ul>
        </>
      ),
    },
  };

  const message = messages[reason] || messages.onlyoffice_required;

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center',
      padding: 24,
      overflow: 'auto',
    }}>
      <Result
        status="warning"
        title={message.title}
        subTitle={message.description}
        extra={[
          <Button type="primary" icon={<SettingOutlined />} key="setup" href="https://helpcenter.onlyoffice.com/installation/docs-community-index.aspx" target="_blank">
            部署 OnlyOffice
          </Button>,
          <Button icon={<DownloadOutlined />} key="download" onClick={handleDownload}>
            下载文件
          </Button>,
        ]}
      />
      <div style={{ width: '100%', maxWidth: 800, marginTop: 24 }}>
        {deploymentGuide}
      </div>
    </div>
  );
};

export default OfficeUnavailableViewer;
