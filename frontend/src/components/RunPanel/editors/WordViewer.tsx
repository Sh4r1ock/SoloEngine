import React, { useEffect, useRef, useState, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { Spin, Result, Button, Empty } from 'antd';
import { ReloadOutlined, DownloadOutlined, FileWordOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';
import { runProjectApi } from '../../../services/runProjectApi';

interface WordViewerProps {
  instanceId: string;
  tab: FileTab;
}

const WordViewer: React.FC<WordViewerProps> = ({ instanceId, tab }) => {
  const { addDomRef, cleanup } = useEditorInstanceManager(instanceId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentInfo, setContentInfo] = useState<{ size: number; type: string } | null>(null);
  const isMountedRef = useRef(true);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      addDomRef(containerRef.current);
    }
  }, [addDomRef]);

  const loadDocument = useCallback(async () => {
    if (!isMountedRef.current) return;
    
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    setLoading(true);
    setError(null);
    
    try {
      let arrayBuffer: ArrayBuffer;
      
      if (tab.content && tab.content.length > 0) {
        if (tab.content.startsWith('data:')) {
          const base64 = tab.content.split(',')[1];
          if (!base64) {
            throw new Error('无效的data URI格式');
          }
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        } else if (/^[A-Za-z0-9+/=]+$/.test(tab.content) && tab.content.length > 100) {
          const binaryString = atob(tab.content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        } else {
          throw new Error('文件内容格式不支持，请使用文件访问接口');
        }
      } else {
        const accessUrl = runProjectApi.getFileAccessUrl(tab.path);
        const response = await fetch(accessUrl, {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('未授权访问，请重新登录');
          } else if (response.status === 404) {
            throw new Error('文件不存在');
          }
          const statusMap: Record<number, string> = {
            400: '请求参数错误',
            403: '没有权限访问',
            500: '服务器内部错误',
            502: '网关错误',
            503: '服务暂时不可用',
            504: '网关超时',
          };
          throw new Error(statusMap[response.status] || `获取文件失败 (${response.status})`);
        }
        
        arrayBuffer = await response.arrayBuffer();
      }
      
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error('文件内容为空');
      }
      
      if (!isMountedRef.current) return;
      
      setContentInfo({
        size: arrayBuffer.byteLength,
        type: 'docx'
      });
      
      const container = containerRef.current;
      if (container) {
        container.innerHTML = '';
        
        await renderAsync(arrayBuffer, container, undefined, {
          className: 'docx-container',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });
      }
      
      if (isMountedRef.current) {
        setLoading(false);
      }
    } catch (err: any) {
      console.error('Word document render error:', err);
      if (isMountedRef.current) {
        setError(err.message || '文档渲染失败');
        setLoading(false);
      }
    }
  }, [tab.content, tab.path]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  useEditorCleanup(instanceId, cleanup);

  const handleDownload = useCallback(() => {
    const accessUrl = runProjectApi.getFileAccessUrl(tab.path);
    const link = document.createElement('a');
    link.href = accessUrl;
    link.download = tab.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [tab.path, tab.name]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f5f5f5' }}>
        <Spin size="large">
          <div style={{ padding: 50 }}>加载Word文档...</div>
        </Spin>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, background: '#f5f5f5' }}>
        <Empty
          image={<FileWordOutlined style={{ fontSize: 64, color: '#1890ff' }} />}
          description={
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: '#666', marginBottom: 8 }}>无法预览此文档</p>
              <p style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>{error}</p>
              {contentInfo && (
                <p style={{ color: '#999', fontSize: 11 }}>
                  文件大小: {(contentInfo.size / 1024).toFixed(2)} KB
                </p>
              )}
            </div>
          }
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <Button 
              type="primary" 
              icon={<ReloadOutlined />}
              onClick={loadDocument}
            >
              重新加载
            </Button>
            <Button 
              icon={<DownloadOutlined />}
              onClick={handleDownload}
            >
              下载文件
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      style={{ 
        height: '100%', 
        overflow: 'auto',
        background: '#f5f5f5',
      }} 
    />
  );
};

export default WordViewer;
