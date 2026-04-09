import React, { useState, useEffect, useRef } from 'react';
import { Spin, message } from 'antd';
import { apiClient } from '../../services/api';

interface OnlyOfficeEditorProps {
  filePath: string;
  fileName: string;
  mode?: 'view' | 'edit';
}

declare global {
  interface Window {
    DocEditor: any;
  }
}

const OnlyOfficeEditor: React.FC<OnlyOfficeEditorProps> = ({
  filePath,
  fileName,
  mode = 'edit'
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [docServerUrl, setDocServerUrl] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const scriptLoadedRef = useRef(false);

  const loadScript = (url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (scriptLoadedRef.current) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = `${url}/web-apps/apps/api/documents/api.js`;
      script.onload = () => {
        scriptLoadedRef.current = true;
        resolve();
      };
      script.onerror = () => {
        reject(new Error('Failed to load OnlyOffice API script'));
      };
      document.head.appendChild(script);
    });
  };

  const fetchEditorConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.post('/run-project/onlyoffice/config', {
        path: filePath,
        mode: mode
      });

      if (response.data.code === 200) {
        setConfig(response.data.data.config);
        setDocServerUrl(response.data.data.documentServerUrl);
      } else {
        throw new Error(response.data.message || '获取配置失败');
      }
    } catch (err: any) {
      console.error('Failed to fetch OnlyOffice config:', err);
      setError(err.message || '加载编辑器失败');
    } finally {
      setLoading(false);
    }
  };

  const initEditor = async () => {
    if (!config || !docServerUrl || !containerRef.current) {
      return;
    }

    try {
      await loadScript(docServerUrl);

      if (window.DocEditor && containerRef.current) {
        containerRef.current.innerHTML = '';
        
        editorRef.current = new window.DocEditor(containerRef.current.id, config);
      }
    } catch (err: any) {
      console.error('Failed to initialize OnlyOffice editor:', err);
      setError(err.message || '初始化编辑器失败');
    }
  };

  useEffect(() => {
    fetchEditorConfig();
  }, [filePath, mode]);

  useEffect(() => {
    if (config && docServerUrl) {
      initEditor();
    }
  }, [config, docServerUrl]);

  useEffect(() => {
    return () => {
      if (editorRef.current && editorRef.current.destroy) {
        try {
          editorRef.current.destroy();
        } catch (e) {
          console.error('Error destroying editor:', e);
        }
      }
    };
  }, []);

  if (loading) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff'
      }}>
        <Spin size="large" tip="正在加载文档编辑器..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        gap: '16px'
      }}>
        <div style={{ fontSize: '48px' }}>📄</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#333' }}>
          {fileName}
        </div>
        <div style={{ fontSize: '14px', color: '#ff4d4f', textAlign: 'center' }}>
          编辑器加载失败: {error}
        </div>
        <div style={{ fontSize: '12px', color: '#8c8c8c', textAlign: 'center' }}>
          OnlyOffice 服务可能未启动，请检查服务状态
        </div>
      </div>
    );
  }

  return (
    <div
      id="onlyoffice-editor-container"
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#fff'
      }}
    />
  );
};

export default OnlyOfficeEditor;
