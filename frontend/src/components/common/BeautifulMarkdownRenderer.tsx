import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';

interface BeautifulMarkdownRendererProps {
  children: string;
  className?: string;
}

const CodeBlock: React.FC<{ language: string; value: string }> = ({
  language,
  value
}) => {
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
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid var(--border-color-light)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 1rem',
        backgroundColor: 'var(--bg-200)',
        borderBottom: '1px solid var(--border-color-light)'
      }}>
        <span style={{
          fontSize: '0.8rem',
          fontWeight: 500,
          color: 'var(--text-200)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          {language || 'text'}
        </span>
        <Tooltip title={copied ? '已复制!' : '复制代码'}>
          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.25rem 0.5rem',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--text-200)',
              fontSize: '0.8rem',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-300)';
              e.currentTarget.style.color = 'var(--text-100)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-200)';
            }}
          >
            {copied ? <CheckOutlined /> : <CopyOutlined />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </Tooltip>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        codeTagProps={{ style: { backgroundColor: 'inherit', padding: 0 } }}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.9em',
          lineHeight: '1.5',
          borderRadius: 0
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};

const MARKDOWN_COMPONENTS = {
  h1: ({ ...props }: any) => (
    <h1 style={{
      fontSize: '1.5rem',
      fontWeight: 600,
      marginBottom: '0.5rem',
      marginTop: '1rem'
    }} {...props} />
  ),
  h2: ({ ...props }: any) => (
    <h2 style={{
      fontSize: '1.25rem',
      fontWeight: 600,
      marginBottom: '0.5rem',
      marginTop: '1rem'
    }} {...props} />
  ),
  h3: ({ ...props }: any) => (
    <h3 style={{
      fontSize: '1.1rem',
      fontWeight: 600,
      marginBottom: '0.5rem',
      marginTop: '0.75rem'
    }} {...props} />
  ),
  h4: ({ ...props }: any) => (
    <h4 style={{
      fontSize: '1rem',
      fontWeight: 600,
      marginBottom: '0.5rem',
      marginTop: '0.75rem'
    }} {...props} />
  ),
  p: ({ ...props }: any) => (
    <p style={{
      marginBottom: '0.75rem',
      lineHeight: 1.7
    }} {...props} />
  ),
  ul: ({ ...props }: any) => (
    <ul style={{
      marginBottom: '0.75rem',
      paddingLeft: '1.5rem'
    }} {...props} />
  ),
  ol: ({ ...props }: any) => (
    <ol style={{
      marginBottom: '0.75rem',
      paddingLeft: '1.5rem'
    }} {...props} />
  ),
  li: ({ ...props }: any) => (
    <li style={{
      marginBottom: '0.25rem',
      lineHeight: 1.6
    }} {...props} />
  ),
  blockquote: ({ ...props }: any) => (
    <blockquote style={{
      borderLeft: '4px solid var(--primary-100)',
      paddingLeft: '1rem',
      marginLeft: 0,
      marginBottom: '0.75rem',
      color: 'var(--text-200)',
      fontStyle: 'italic'
    }} {...props} />
  ),
  code: ({ className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const content = String(children);
    const isInline = !match && !content.includes('\n');
    return isInline ? (
      <code style={{
        fontFamily: 'var(--font-family-code)',
        backgroundColor: 'var(--bg-tertiary)',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.9em',
        color: 'var(--error-color)'
      }} className={className} {...props}>
        {children}
      </code>
    ) : match ? (
      <CodeBlock
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
      margin: 0,
      padding: 0,
      backgroundColor: 'transparent',
      borderRadius: 0,
      border: 'none',
      overflowX: 'visible'
    }} {...props} />
  ),
  table: ({ ...props }: any) => (
    <div style={{ overflowX: 'auto', marginBottom: '0.75rem' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.95rem'
      }} {...props} />
    </div>
  ),
  thead: ({ ...props }: any) => (
    <thead style={{ backgroundColor: 'var(--bg-tertiary)' }} {...props} />
  ),
  th: ({ ...props }: any) => (
    <th style={{
      padding: '0.5rem 0.75rem',
      textAlign: 'left',
      borderBottom: '2px solid var(--border-color-light)',
      fontWeight: 600
    }} {...props} />
  ),
  td: ({ ...props }: any) => (
    <td style={{
      padding: '0.5rem 0.75rem',
      borderBottom: '1px solid var(--border-color-light)'
    }} {...props} />
  ),
  a: ({ ...props }: any) => (
    <a style={{
      color: 'var(--primary-100)',
      textDecoration: 'none',
      fontWeight: 500
    }} target="_blank" rel="noopener noreferrer" {...props} />
  ),
  strong: ({ ...props }: any) => (
    <strong style={{ fontWeight: 600 }} {...props} />
  ),
  em: ({ ...props }: any) => (
    <em style={{ fontStyle: 'italic' }} {...props} />
  ),
  hr: ({ ...props }: any) => (
    <hr style={{
      border: 'none',
      borderTop: '1px solid var(--border-color-light)',
      margin: '1.5rem 0'
    }} {...props} />
  ),
  img: ({ ...props }: any) => (
    <img style={{
      maxWidth: '100%',
      height: 'auto',
      borderRadius: '8px',
      margin: 0
    }} {...props} />
  )
};

const BeautifulMarkdownRenderer: React.FC<BeautifulMarkdownRendererProps> = ({
  children,
  className = ''
}) => {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
};

export default BeautifulMarkdownRenderer;
