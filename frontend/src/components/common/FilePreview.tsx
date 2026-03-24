import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Typography, Spin, Button, message } from 'antd';
import { DownloadOutlined, FilePdfOutlined, FileImageOutlined } from '@ant-design/icons';
import { runProjectApi } from '../../services/runProjectApi';
import { apiClient } from '../../services/api';

const { Text } = Typography;

const OnlyOfficeEditor = lazy(() => import('./OnlyOfficeEditor'));

interface FilePreviewProps {
  fileName: string;
  filePath: string;
  fileType?: 'code' | 'markdown' | 'text' | 'office' | 'pdf' | 'image';
}

const FilePreview: React.FC<FilePreviewProps> = ({ fileName, filePath, fileType }) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isImageFile = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext);
  const isPDFFile = ext === 'pdf';
  const isOfficeEditableFile = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'].includes(ext);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  const loadFileAsBlob = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const fullFileUrl = runProjectApi.getFileAccessUrl(filePath);
      console.log('Original fullFileUrl:', fullFileUrl);
      
      const getCookie = (name: string): string | null => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
          return decodeURIComponent(parts.pop()?.split(';').shift() || '');
        }
        return null;
      };
      
      const token = getCookie('access_token') || localStorage.getItem('access_token');
      console.log('Token available:', !!token);
      
      const response = await fetch(fullFileUrl, {
        method: 'GET',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });
      
      console.log('Fetch response status:', response.status);
      console.log('Fetch response ok:', response.ok);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      console.log('Blob size:', blob.size);
      console.log('Blob type:', blob.type);
      
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      
      const newBlobUrl = URL.createObjectURL(blob);
      setBlobUrl(newBlobUrl);
    } catch (err: any) {
      console.error('Failed to load file as blob:', err);
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      setLoading(true);
      let fileUrl = runProjectApi.getFileAccessUrl(filePath);
      if (fileUrl.startsWith('/api/v1')) {
        fileUrl = fileUrl.substring('/api/v1'.length);
      }
      const response = await apiClient.get(fileUrl, {
        responseType: 'blob',
      });
      
      const blob = response.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success('文件下载成功');
    } catch (err) {
      console.error('Failed to download file:', err);
      message.error('文件下载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isImageFile || isPDFFile) {
      loadFileAsBlob();
    }
  }, [filePath]);

  const getFileIcon = () => {
    if (isPDFFile) return <FilePdfOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />;
    if (isImageFile) return <FileImageOutlined style={{ fontSize: 48, color: '#52c41a' }} />;
    return <FileImageOutlined style={{ fontSize: 48, color: '#8c8c8c' }} />;
  };

  const getFileTypeLabel = () => {
    if (isPDFFile) return 'PDF 文档';
    if (isImageFile) return '图片文件';
    return '文件';
  };

  if (isOfficeEditableFile) {
    return (
      <Suspense fallback={
        <div style={{ 
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fff'
        }}>
          <Spin size="large" tip="正在加载 Office 编辑器..." />
        </div>
      }>
        <OnlyOfficeEditor 
          filePath={filePath}
          fileName={fileName}
          mode="edit"
        />
      </Suspense>
    );
  }

  if (isImageFile) {
    return (
      <div style={{ 
        background: '#fff',
        height: '100%',
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}>
        {loading && (
          <div style={{ 
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 100,
          }}>
            <Spin size="large" />
          </div>
        )}
        {error ? (
          <div style={{ 
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12 
          }}>
            <div style={{ fontSize: 48 }}>🖼️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>
              {fileName}
            </div>
            <div style={{ fontSize: 12, color: '#ff4d4f', textAlign: 'center' }}>
              无法加载图片: {error}
            </div>
            <Button type="primary" onClick={loadFileAsBlob}>重试</Button>
          </div>
        ) : blobUrl ? (
          <img 
            src={blobUrl} 
            alt={fileName}
            style={{ 
              maxWidth: '100%', 
              maxHeight: '100%', 
              objectFit: 'contain',
              display: imageLoaded ? 'block' : 'none'
            }}
            onLoad={() => setImageLoaded(true)}
            onError={(e) => {
              console.error('Image load error');
              setError('图片加载失败');
            }}
          />
        ) : null}
      </div>
    );
  }

  if (isPDFFile) {
    return (
      <div style={{ 
        background: '#fff',
        height: '100%',
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}>
        {loading && (
          <div style={{ 
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 100,
          }}>
            <Spin size="large" />
          </div>
        )}
        {error ? (
          <div style={{ 
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12 
          }}>
            <FilePdfOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>
              {fileName}
            </div>
            <div style={{ fontSize: 12, color: '#ff4d4f', textAlign: 'center' }}>
              无法加载 PDF: {error}
            </div>
            <Button type="primary" onClick={loadFileAsBlob}>重试</Button>
          </div>
        ) : blobUrl ? (
          <iframe
            ref={iframeRef}
            src={blobUrl}
            style={{ 
              width: '100%', 
              height: '100%', 
              border: 'none',
              background: 'white'
            }}
            title={fileName}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ 
      background: '#fff',
      borderRadius: 8,
      padding: 24,
      height: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    }}>
      {getFileIcon()}
      <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>
        {fileName}
      </div>
      <div style={{ fontSize: 12, color: '#666', textAlign: 'center' }}>
        文件类型: .{ext}<br/>
        此文件类型需要专门的查看器
      </div>
      <Button 
        type="primary" 
        size="small" 
        icon={<DownloadOutlined />}
        onClick={handleDownload}
        loading={loading}
      >
        下载
      </Button>
    </div>
  );
};

export default FilePreview;
