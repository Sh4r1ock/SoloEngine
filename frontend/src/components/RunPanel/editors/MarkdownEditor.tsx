import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Tooltip, Spin } from 'antd';
import { EditOutlined, EyeOutlined, ColumnWidthOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface MarkdownEditorProps {
  instanceId: string;
  tab: FileTab;
  canEdit?: boolean;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

type ViewMode = 'edit' | 'split' | 'preview';

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  instanceId,
  tab,
  canEdit = true,
  onContentChange,
  onSave,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [depsLoaded, setDepsLoaded] = useState(false);
  const [CodeMirrorComp, setCodeMirrorComp] = useState<React.ComponentType<any> | null>(null);
  const [ReactMarkdownComp, setReactMarkdownComp] = useState<React.ComponentType<any> | null>(null);
  const [oneDark, setOneDark] = useState<any>(null);
  const [plugins, setPlugins] = useState<{ remarkGfm: any; rehypeHighlight: any; rehypeRaw: any } | null>(null);
  
  const { addTimer, removeTimer, cleanup } = useEditorInstanceManager(instanceId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    
    const loadAllDependencies = async () => {
      try {
        const [
          cmModule,
          mdModule,
          odModule,
          gfmModule,
          hlModule,
          rawModule,
        ] = await Promise.all([
          import('@uiw/react-codemirror'),
          import('react-markdown'),
          import('@codemirror/theme-one-dark'),
          import('remark-gfm'),
          import('rehype-highlight'),
          import('rehype-raw'),
        ]);
        
        if (!mounted) return;
        
        setCodeMirrorComp(() => cmModule.default);
        setReactMarkdownComp(() => mdModule.default);
        setOneDark(odModule.oneDark);
        setPlugins({
          remarkGfm: gfmModule.default,
          rehypeHighlight: hlModule.default,
          rehypeRaw: rawModule.default,
        });
        setDepsLoaded(true);
      } catch (err) {
        console.error('Failed to load markdown editor dependencies:', err);
      }
    };
    
    loadAllDependencies();
    
    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = useCallback((value: string) => {
    onContentChange(tab.id, value);
    
    if (saveTimeoutRef.current) {
      removeTimer(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = addTimer(setTimeout(() => {
      if (tab.isModified) {
        onSave(tab);
      }
    }, 500));
  }, [tab.id, tab.isModified, onContentChange, onSave, addTimer, removeTimer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave(tab);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tab, onSave]);

  useEditorCleanup(instanceId, cleanup);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  const renderViewModeButton = (mode: ViewMode, icon: React.ReactNode, title: string) => (
    <Tooltip key={mode} title={title}>
      <Button
        type={viewMode === mode ? 'primary' : 'text'}
        icon={icon}
        onClick={() => handleViewModeChange(mode)}
        size="small"
        style={{ 
          minWidth: 32,
          color: viewMode === mode ? '#fff' : 'var(--text-200)'
        }}
      />
    </Tooltip>
  );

  const content = tab.content || '';

  if (!depsLoaded || !CodeMirrorComp || !ReactMarkdownComp || !oneDark || !plugins) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#1e1e1e' }}>
        <Spin size="large" tip="加载Markdown编辑器..." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', background: '#1e1e1e' }}>
      <style>{`
        .markdown-preview-wrapper {
          color: #e6e6e6 !important;
          line-height: 1.6;
          font-size: 14px;
          background: #1e1e1e !important;
        }
        .markdown-preview-wrapper * {
          color: #e6e6e6 !important;
        }
        .markdown-preview-wrapper h1 { 
          font-size: 2em; 
          border-bottom: 1px solid #444; 
          padding-bottom: 0.3em; 
          margin: 1em 0 0.5em; 
          color: #ffffff !important; 
        }
        .markdown-preview-wrapper h2 { 
          font-size: 1.5em; 
          border-bottom: 1px solid #444; 
          padding-bottom: 0.3em; 
          margin: 1em 0 0.5em; 
          color: #ffffff !important; 
        }
        .markdown-preview-wrapper h3 { 
          font-size: 1.25em; 
          margin: 1em 0 0.5em; 
          color: #ffffff !important; 
        }
        .markdown-preview-wrapper h4 { 
          font-size: 1em; 
          margin: 1em 0 0.5em; 
          color: #ffffff !important; 
        }
        .markdown-preview-wrapper h5 { 
          font-size: 0.875em; 
          margin: 1em 0 0.5em; 
          color: #dddddd !important; 
        }
        .markdown-preview-wrapper h6 { 
          font-size: 0.85em; 
          color: #aaaaaa !important; 
          margin: 1em 0 0.5em; 
        }
        .markdown-preview-wrapper p { 
          margin: 0 0 1em; 
          color: #e6e6e6 !important; 
        }
        .markdown-preview-wrapper a { 
          color: #58a6ff !important; 
          text-decoration: none; 
        }
        .markdown-preview-wrapper a:hover { 
          text-decoration: underline; 
        }
        .markdown-preview-wrapper code:not(.hljs) { 
          background: #2d333b !important; 
          padding: 0.2em 0.4em; 
          border-radius: 3px; 
          font-size: 85%;
          font-family: Consolas, Monaco, monospace;
          color: #e6e6e6 !important;
        }
        .markdown-preview-wrapper pre { 
          background: #161b22 !important; 
          padding: 16px; 
          border-radius: 6px; 
          overflow-x: auto;
          margin: 0 0 1em;
        }
        .markdown-preview-wrapper pre code {
          background: transparent !important;
          padding: 0;
          font-size: 85%;
          color: #e6e6e6 !important;
        }
        .markdown-preview-wrapper .hljs {
          background: #161b22 !important;
          color: #e6e6e6 !important;
        }
        .markdown-preview-wrapper .hljs-keyword,
        .markdown-preview-wrapper .hljs-selector-tag,
        .markdown-preview-wrapper .hljs-built_in,
        .markdown-preview-wrapper .hljs-name,
        .markdown-preview-wrapper .hljs-tag {
          color: #ff7b72 !important;
        }
        .markdown-preview-wrapper .hljs-string,
        .markdown-preview-wrapper .hljs-title,
        .markdown-preview-wrapper .hljs-section,
        .markdown-preview-wrapper .hljs-attribute,
        .markdown-preview-wrapper .hljs-literal,
        .markdown-preview-wrapper .hljs-template-tag,
        .markdown-preview-wrapper .hljs-template-variable,
        .markdown-preview-wrapper .hljs-type {
          color: #a5d6ff !important;
        }
        .markdown-preview-wrapper .hljs-comment,
        .markdown-preview-wrapper .hljs-deletion {
          color: #8b949e !important;
        }
        .markdown-preview-wrapper .hljs-number,
        .markdown-preview-wrapper .hljs-regexp,
        .markdown-preview-wrapper .hljs-addition {
          color: #79c0ff !important;
        }
        .markdown-preview-wrapper blockquote { 
          border-left: 4px solid #444c56; 
          padding-left: 1em; 
          margin: 0 0 1em;
          color: #8b949e !important;
        }
        .markdown-preview-wrapper blockquote * {
          color: #8b949e !important;
        }
        .markdown-preview-wrapper ul, .markdown-preview-wrapper ol { 
          padding-left: 2em; 
          margin: 0 0 1em;
        }
        .markdown-preview-wrapper li { 
          margin: 0.25em 0; 
          color: #e6e6e6 !important; 
        }
        .markdown-preview-wrapper table { 
          border-collapse: collapse; 
          width: 100%;
          margin: 0 0 1em;
        }
        .markdown-preview-wrapper th, .markdown-preview-wrapper td { 
          border: 1px solid #444c56; 
          padding: 8px 12px;
          color: #e6e6e6 !important;
        }
        .markdown-preview-wrapper th { 
          background: #21262d !important; 
          color: #ffffff !important; 
        }
        .markdown-preview-wrapper tr:nth-child(even) { 
          background: #161b22 !important; 
        }
        .markdown-preview-wrapper img { 
          max-width: 100%; 
        }
        .markdown-preview-wrapper hr { 
          border: none; 
          border-top: 1px solid #444; 
          margin: 1.5em 0; 
        }
      `}</style>
      <div style={{ 
        display: 'flex', 
        gap: 4, 
        padding: '8px 12px',
        borderBottom: '1px solid #333',
        background: '#252526',
        alignItems: 'center',
      }}>
        {renderViewModeButton('edit', <EditOutlined />, '编辑模式')}
        {renderViewModeButton('split', <ColumnWidthOutlined />, '分栏模式')}
        {renderViewModeButton('preview', <EyeOutlined />, '预览模式')}
        <div style={{ flex: 1 }} />
        {tab.isModified && <span style={{ color: '#faad14', fontSize: 12 }}>未保存</span>}
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div style={{ 
            flex: viewMode === 'split' ? 1 : 2, 
            overflow: 'auto',
            borderRight: viewMode === 'split' ? '1px solid #333' : 'none',
          }}>
            <CodeMirrorComp
              value={content}
              height="100%"
              onChange={handleChange}
              theme="dark"
              editable={canEdit}
              extensions={[oneDark]}
              style={{ fontSize: 13 }}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightSpecialChars: true,
                history: true,
                foldGutter: true,
                drawSelection: true,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                syntaxHighlighting: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                rectangularSelection: true,
                crosshairCursor: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
              }}
            />
          </div>
        )}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div 
            ref={containerRef}
            className="markdown-preview-wrapper"
            style={{ 
              flex: viewMode === 'split' ? 1 : 2, 
              overflow: 'auto',
              padding: 16,
              background: '#1e1e1e',
            }}
          >
            {content ? (
              <ReactMarkdownComp
                remarkPlugins={[plugins.remarkGfm]}
                rehypePlugins={[plugins.rehypeHighlight, plugins.rehypeRaw]}
              >
                {content}
              </ReactMarkdownComp>
            ) : (
              <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>
                文件内容为空
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownEditor;
