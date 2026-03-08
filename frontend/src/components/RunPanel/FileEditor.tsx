/**
 * @file FileEditor.tsx
 * @description 文件编辑器组件 - 文件内容查看和编辑
 * @author SoloEngine Team
 * @date 2026-02-23
 */
import React, { useState, useEffect } from 'react';
import { Button, Space, Spin, Typography, message, Alert, Tooltip } from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  CloseOutlined,
  FileOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { runProjectApi, FileInfo } from '../../services/runProjectApi';

const { Text } = Typography;

interface FileEditorProps {
  file: FileInfo | null;
  onClose: () => void;
}

const FileEditor: React.FC<FileEditorProps> = ({ file, onClose }) => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);

  useEffect(() => {
    if (file) {
      loadFileContent();
    }
  }, [file]);

  const loadFileContent = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const response = await runProjectApi.readFile(file.path);
      if (response.code === 200) {
        const fileContent = response.data.content;
        setContent(fileContent);
        setOriginalContent(fileContent);
        setModified(false);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载文件失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!file || !modified) return;

    setSaving(true);
    try {
      await runProjectApi.writeFile(file.path, content);
      setOriginalContent(content);
      setModified(false);
      message.success('文件已保存');
    } catch (err: any) {
      message.error('保存失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setModified(newContent !== originalContent);
  };

  const handleUndo = () => {
    setContent(originalContent);
    setModified(false);
  };

  const handleClose = () => {
    if (modified) {
      if (window.confirm('文件已修改，确定要关闭吗？未保存的更改将丢失。')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      js: 'JavaScript',
      jsx: 'JavaScript (React)',
      ts: 'TypeScript',
      tsx: 'TypeScript (React)',
      py: 'Python',
      json: 'JSON',
      html: 'HTML',
      css: 'CSS',
      scss: 'SCSS',
      less: 'Less',
      md: 'Markdown',
      yaml: 'YAML',
      yml: 'YAML',
      xml: 'XML',
      sql: 'SQL',
      sh: 'Shell',
      bash: 'Bash',
    };
    return langMap[ext || ''] || 'Plain Text';
  };

  if (!file) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-secondary)',
        }}
      >
        <Text type="secondary">选择文件以查看内容</Text>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-100)',
        }}
      >
        <Space>
          <FileOutlined style={{ color: 'var(--primary-100)' }} />
          <Text strong style={{ fontSize: 13 }}>
            {file.name}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {getLanguage(file.name)}
          </Text>
          {modified && (
            <Text type="warning" style={{ fontSize: 12 }}>
              • 已修改
            </Text>
          )}
        </Space>
        <Space size={4}>
          {modified && (
            <Tooltip title="撤销更改">
              <Button
                type="text"
                size="small"
                icon={<UndoOutlined />}
                onClick={handleUndo}
              />
            </Tooltip>
          )}
          <Tooltip title="保存 (Ctrl+S)">
            <Button
              type="text"
              size="small"
              icon={<SaveOutlined />}
              onClick={handleSave}
              disabled={!modified}
              loading={saving}
            />
          </Tooltip>
          <Tooltip title="重新加载">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadFileContent}
              loading={loading}
            />
          </Tooltip>
          <Tooltip title="关闭">
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={handleClose}
            />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-100)',
            }}
          >
            <Spin />
          </div>
        ) : error ? (
          <div style={{ padding: 16 }}>
            <Alert
              message="加载失败"
              description={error}
              type="error"
              showIcon
            />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={handleContentChange}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '12px 16px',
              fontFamily: 'var(--font-family-code)',
              fontSize: 13,
              lineHeight: 1.6,
              background: 'var(--bg-100)',
              color: 'var(--text-primary)',
            }}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        )}
      </div>
    </div>
  );
};

export default FileEditor;
