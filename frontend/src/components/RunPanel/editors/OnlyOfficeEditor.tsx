import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Spin, Result, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';
import { useOfficeConfigStore } from '../stores/officeConfigStore';

interface OnlyOfficeEditorProps {
  instanceId: string;
  tab: FileTab;
  canEdit?: boolean;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

declare global {
  interface Window {
    DocsAPI: any;
  }
}

const OnlyOfficeEditor: React.FC<OnlyOfficeEditorProps> = ({
  instanceId,
  tab,
  canEdit = true,
  onContentChange,
  onSave,
}) => {
  const { cleanup, addEventListener } = useEditorInstanceManager(instanceId);
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useOfficeConfigStore();

  const onlyOfficeUrl = config.url || 'http://localhost:8080';

  const initEditor = useCallback(() => {
    if (!window.DocsAPI || !containerRef.current) {
      setError('OnlyOffice API 加载失败');
      setLoading(false);
      return;
    }

    const ext = tab.name.split('.').pop()?.toLowerCase();
    const documentType = ext === 'docx' || ext === 'doc' ? 'word' 
                       : ext === 'xlsx' || ext === 'xls' || ext === 'csv' ? 'cell' 
                       : 'slide';

    try {
      editorRef.current = new window.DocsAPI.DocEditor(containerRef.current, {
        document: {
          fileType: ext,
          key: `${tab.id}-${Date.now()}`,
          title: tab.name,
          url: `/api/files/${tab.id}/download`,
          permissions: {
            edit: canEdit,
            download: true,
            print: true,
            review: true,
          },
        },
        documentType,
        editorConfig: {
          mode: canEdit ? 'edit' : 'view',
          callbackUrl: `/api/files/${tab.id}/callback`,
          user: {
            id: 'agent-user',
            name: 'AI Agent User',
          },
          customization: {
            trackChanges: canEdit,
            showReviewChanges: true,
            reviewDisplay: 'markup',
            autosave: true,
            chat: false,
            comments: true,
            compactHeader: false,
            compactToolbar: false,
            help: false,
            hideRightMenu: false,
            hideRulers: false,
            spellcheck: true,
            toolbarNoTabs: false,
            unit: 'cm',
            zoom: 100,
          },
        },
        events: {
          onDocumentStateChange: (event: any) => {
            if (event.data) {
              onContentChange(tab.id, 'modified');
            }
          },
          onError: (event: any) => {
            console.error('OnlyOffice error:', event);
            setError(`编辑器错误: ${event.data?.errorDescription || '未知错误'}`);
          },
          onReady: () => {
            setLoading(false);
          },
        },
      });
    } catch (err: any) {
      console.error('Failed to initialize OnlyOffice:', err);
      setError(`初始化失败: ${err.message}`);
      setLoading(false);
    }
  }, [tab, canEdit, onContentChange]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = `${onlyOfficeUrl}/web-apps/apps/api/documents/api.js`;
    script.async = true;
    
    script.onload = () => {
      initEditor();
    };
    
    script.onerror = () => {
      setError('无法加载 OnlyOffice API，请检查服务是否正常运行');
      setLoading(false);
    };
    
    document.head.appendChild(script);

    return () => {
      if (editorRef.current) {
        try {
          editorRef.current.destroyEditor();
        } catch {}
        editorRef.current = null;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [onlyOfficeUrl, initEditor]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave(tab);
      }
    };
    addEventListener(window, 'keydown', handleKeyDown as EventListener);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tab, onSave, addEventListener]);

  useEditorCleanup(instanceId, cleanup);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载 OnlyOffice 编辑器..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <Result
          status="error"
          title="编辑器加载失败"
          subTitle={error}
          extra={
            <Button 
              type="primary" 
              icon={<ReloadOutlined />}
              onClick={() => {
                setError(null);
                setLoading(true);
                initEditor();
              }}
            >
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', height: '100%' }} 
      id={`onlyoffice-${instanceId}`}
    />
  );
};

export default OnlyOfficeEditor;
