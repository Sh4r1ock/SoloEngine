import React, { useState, useCallback, useEffect, useRef, useMemo, useDeferredValue } from 'react';
import { Button, Tooltip, Spin } from 'antd';
import { EditOutlined, EyeOutlined, ColumnWidthOutlined, CheckOutlined, CopyOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface MarkdownEditorProps {
  instanceId: string;
  tab: FileTab;
  canEdit?: boolean;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
  theme?: 'dark' | 'light';
}

type ViewMode = 'edit' | 'split' | 'preview';

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  instanceId,
  tab,
  canEdit = true,
  onContentChange,
  onSave,
  theme = 'dark',
}) => {
  // 将instanceId中的特殊字符替换为安全字符，用于CSS类名
  const safeInstanceId = instanceId.replace(/[^a-zA-Z0-9-_]/g, '_');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [depsLoaded, setDepsLoaded] = useState(false);
  const [CodeMirrorComp, setCodeMirrorComp] = useState<React.ComponentType<any> | null>(null);
  const [ReactMarkdownComp, setReactMarkdownComp] = useState<React.ComponentType<any> | null>(null);
  const [oneDark, setOneDark] = useState<any>(null);
  const [SyntaxHighlighterModule, setSyntaxHighlighterModule] = useState<any>(null);
  const [vscDarkPlusStyle, setVscDarkPlusStyle] = useState<any>(null);
  const [prismStyle, setPrismStyle] = useState<any>(null);
  const [plugins, setPlugins] = useState<{ remarkGfm: any; remarkBreaks: any; rehypeRaw: any } | null>(null);
  
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
          breaksModule,
          rawModule,
          shModule,
          prismStyleModule,
        ] = await Promise.all([
          import('@uiw/react-codemirror'),
          import('react-markdown'),
          import('@codemirror/theme-one-dark'),
          import('remark-gfm'),
          import('remark-breaks'),
          import('rehype-raw'),
          import('react-syntax-highlighter'),
          import('react-syntax-highlighter/dist/esm/styles/prism'),
        ]);
        
        if (!mounted) return;
        
        setCodeMirrorComp(() => cmModule.default);
        setReactMarkdownComp(() => mdModule.default);
        setOneDark(odModule.oneDark);
        setPlugins({
          remarkGfm: gfmModule.default,
          remarkBreaks: breaksModule.default,
          rehypeRaw: rawModule.default,
        });
        setSyntaxHighlighterModule(shModule);
        const { vscDarkPlus, prism } = prismStyleModule;
        setVscDarkPlusStyle(vscDarkPlus);
        setPrismStyle(prism);
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
  const deferredContent = useDeferredValue(content);

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#1e1e1e' : '#ffffff';
  const headerBgColor = isDark ? '#252526' : '#fafafa';
  const borderColor = isDark ? '#333' : '#e8e8e8';
  const textColor = isDark ? '#e6e6e6' : '#333333';
  const previewTextColor = isDark ? '#e6e6e6' : '#333333';
  const previewBgColor = isDark ? '#1e1e1e' : '#ffffff';
  const codeBgColor = isDark ? '#2d333b' : '#f5f5f5';
  const blockquoteBorderColor = isDark ? '#444c56' : '#e8e8e8';
  const blockquoteColor = isDark ? '#8b949e' : '#666666';
  const tableBorderColor = isDark ? '#444c56' : '#e8e8e8';
  const tableHeaderBgColor = isDark ? '#21262d' : '#f5f5f5';
  const tableRowEvenBgColor = isDark ? '#161b22' : '#fafafa';
  const linkColor = isDark ? '#58a6ff' : '#1890ff';
  const hrColor = isDark ? '#444' : '#e8e8e8';

  if (!depsLoaded || !CodeMirrorComp || !ReactMarkdownComp || !oneDark || !plugins || !SyntaxHighlighterModule || !vscDarkPlusStyle || !prismStyle) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: bgColor }}>
        <Spin size="large" tip="加载Markdown编辑器..." />
      </div>
    );
  }

  const SyntaxHighlighter = SyntaxHighlighterModule.Prism;

  const CodeBlockComponent: React.FC<{ language: string; value: string }> = ({ language, value }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    return (
      <div style={{
        position: 'relative',
        marginBottom: '0.75rem',
        borderRadius: '6px',
        overflow: 'hidden',
        border: `1px solid ${borderColor}`
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.4rem 0.75rem',
          backgroundColor: isDark ? '#21262d' : '#f0f0f0',
          borderBottom: `1px solid ${borderColor}`
        }}>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: isDark ? '#8b949e' : '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            {language || 'text'}
          </span>
          <Tooltip title={copied ? '已复制!' : '复制代码'}>
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={handleCopy}
              style={{ color: isDark ? '#8b949e' : '#666', fontSize: 12 }}
            >
              {copied ? '已复制' : '复制'}
            </Button>
          </Tooltip>
        </div>
        <SyntaxHighlighter
          style={isDark ? vscDarkPlusStyle : prismStyle}
          language={language}
          PreTag="div"
          codeTagProps={{ style: { backgroundColor: 'inherit', padding: 0 } }}
          customStyle={{
            margin: 0,
            padding: '0.75rem',
            fontSize: '0.85em',
            lineHeight: '1.5',
            borderRadius: 0
          }}
        >
          {value.replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  };

  const EDITOR_MARKDOWN_COMPONENTS = {
    h1: ({ ...props }: any) => (
      <h1 style={{
        fontSize: '2em',
        fontWeight: 600,
        borderBottom: `1px solid ${isDark ? '#444' : '#e8e8e8'}`,
        paddingBottom: '0.3em',
        margin: '1em 0 0.5em',
        color: isDark ? '#ffffff' : '#333333'
      }} {...props} />
    ),
    h2: ({ ...props }: any) => (
      <h2 style={{
        fontSize: '1.5em',
        fontWeight: 600,
        borderBottom: `1px solid ${isDark ? '#444' : '#e8e8e8'}`,
        paddingBottom: '0.3em',
        margin: '1em 0 0.5em',
        color: isDark ? '#ffffff' : '#333333'
      }} {...props} />
    ),
    h3: ({ ...props }: any) => (
      <h3 style={{
        fontSize: '1.25em',
        fontWeight: 600,
        margin: '1em 0 0.5em',
        color: isDark ? '#ffffff' : '#333333'
      }} {...props} />
    ),
    h4: ({ ...props }: any) => (
      <h4 style={{
        fontSize: '1em',
        fontWeight: 600,
        margin: '1em 0 0.5em',
        color: isDark ? '#ffffff' : '#333333'
      }} {...props} />
    ),
    h5: ({ ...props }: any) => (
      <h5 style={{
        fontSize: '0.875em',
        fontWeight: 600,
        margin: '1em 0 0.5em',
        color: isDark ? '#dddddd' : '#555555'
      }} {...props} />
    ),
    h6: ({ ...props }: any) => (
      <h6 style={{
        fontSize: '0.85em',
        fontWeight: 600,
        color: isDark ? '#aaaaaa' : '#666666',
        margin: '1em 0 0.5em'
      }} {...props} />
    ),
    p: ({ ...props }: any) => (
      <p style={{
        marginBottom: '0.75em',
        lineHeight: 1.7,
        color: previewTextColor
      }} {...props} />
    ),
    a: ({ ...props }: any) => (
      <a style={{
        color: linkColor,
        textDecoration: 'none'
      }} target="_blank" rel="noopener noreferrer" {...props} />
    ),
    strong: ({ ...props }: any) => (
      <strong style={{ fontWeight: 600 }} {...props} />
    ),
    em: ({ ...props }: any) => (
      <em style={{ fontStyle: 'italic' }} {...props} />
    ),
    del: ({ ...props }: any) => (
      <del style={{ textDecoration: 'line-through' }} {...props} />
    ),
    ul: ({ ...props }: any) => (
      <ul style={{
        paddingLeft: '1.5em',
        marginBottom: '0.75em',
        listStyleType: 'disc',
        color: previewTextColor
      }} {...props} />
    ),
    ol: ({ ...props }: any) => (
      <ol style={{
        paddingLeft: '1.5em',
        marginBottom: '0.75em',
        listStyleType: 'decimal',
        color: previewTextColor
      }} {...props} />
    ),
    li: ({ ...props }: any) => (
      <li style={{
        marginBottom: '0.25em',
        lineHeight: 1.6,
        color: previewTextColor
      }} {...props} />
    ),
    blockquote: ({ ...props }: any) => (
      <blockquote style={{
        borderLeft: `4px solid ${blockquoteBorderColor}`,
        paddingLeft: '1em',
        margin: '0 0 1em',
        color: blockquoteColor
      }} {...props} />
    ),
    table: ({ ...props }: any) => (
      <div style={{ overflowX: 'auto', marginBottom: '0.75em' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.95em'
        }} {...props} />
      </div>
    ),
    thead: ({ ...props }: any) => (
      <thead style={{ backgroundColor: tableHeaderBgColor }} {...props} />
    ),
    th: ({ ...props }: any) => (
      <th style={{
        padding: '0.5em 0.75em',
        textAlign: 'left',
        borderBottom: `2px solid ${borderColor}`,
        fontWeight: 600,
        color: isDark ? '#ffffff' : '#333333'
      }} {...props} />
    ),
    td: ({ ...props }: any) => (
      <td style={{
        padding: '0.5em 0.75em',
        borderBottom: `1px solid ${borderColor}`,
        color: previewTextColor
      }} {...props} />
    ),
    hr: ({ ...props }: any) => (
      <hr style={{
        border: 'none',
        borderTop: `1px solid ${hrColor}`,
        margin: '1.5em 0'
      }} {...props} />
    ),
    img: ({ ...props }: any) => (
      <img style={{
        maxWidth: '100%',
        height: 'auto',
        borderRadius: '8px',
        margin: 0
      }} {...props} />
    ),
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const content = String(children);
      const isInline = !match && !content.includes('\n');
      return isInline ? (
        <code style={{
          backgroundColor: codeBgColor,
          padding: '0.2em 0.4em',
          borderRadius: '3px',
          fontSize: '85%',
          fontFamily: 'Consolas, Monaco, monospace',
          color: previewTextColor
        }} className={className} {...props}>
          {children}
        </code>
      ) : match ? (
        <CodeBlockComponent
          language={match[1]}
          value={content.replace(/\n$/, '')}
        />
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre: ({ ...props }: any) => (
      <pre style={{
        margin: '0 0 1em',
        padding: 0,
        backgroundColor: 'transparent',
        borderRadius: 0,
        border: 'none',
        overflowX: 'visible'
      }} {...props} />
    ),
    source: ({ ...props }: any) => (
      <source {...props} />
    ),
  };

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', background: bgColor }}>
      <style>{`
        .markdown-preview-wrapper-${safeInstanceId} {
          color: ${previewTextColor};
          line-height: 1.6;
          font-size: 14px;
          background: ${previewBgColor};
        }
        .markdown-preview-wrapper-${safeInstanceId} p a + br {
          display: none;
        }
      `}</style>
      <div style={{ 
        display: 'flex', 
        gap: 4, 
        padding: '8px 12px',
        borderBottom: `1px solid ${borderColor}`,
        background: headerBgColor,
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
            borderRight: viewMode === 'split' ? `1px solid ${borderColor}` : 'none',
          }}>
            <CodeMirrorComp
              value={content}
              height="100%"
              onChange={handleChange}
              theme={isDark ? 'dark' : 'light'}
              editable={canEdit}
              extensions={isDark ? [oneDark] : []}
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
            className={`markdown-preview-wrapper-${safeInstanceId}`}
            style={{ 
              flex: viewMode === 'split' ? 1 : 2, 
              overflow: 'auto',
              padding: 16,
              background: previewBgColor,
            }}
          >
            {content ? (
              <ReactMarkdownComp
                remarkPlugins={[plugins.remarkGfm, plugins.remarkBreaks]}
                rehypePlugins={[plugins.rehypeRaw]}
                components={EDITOR_MARKDOWN_COMPONENTS}
              >
                {deferredContent}
              </ReactMarkdownComp>
            ) : (
              <div style={{ color: isDark ? '#888' : '#999', textAlign: 'center', padding: 40 }}>
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
