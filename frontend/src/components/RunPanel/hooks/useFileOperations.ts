/**
 * @file hooks/useFileOperations.ts
 * @description 文件操作 Hook
 */

import { useCallback, useRef } from 'react';
import { message } from 'antd';
import { useRunPanelStore } from '../stores/runPanelStore';
import { runProjectApi } from '../../../services/runProjectApi';
import type { FileTab } from '../types';

export const useFileOperations = (runProjectId?: string) => {
  const {
    editorTabs,
    setEditorTabs,
    documentTabs,
    setDocumentTabs,
    activeEditorTab,
    setActiveEditorTab,
    activeDocumentTab,
    setActiveDocumentTab,
    currentProject,
  } = useRunPanelStore();

  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleFileSelect = useCallback(async (filePath: string, fileType: 'editor' | 'document' = 'editor') => {
    if (!currentProject?.id) {
      message.error('请先选择项目');
      return;
    }

    try {
      const content = await runProjectApi.getFileContent(currentProject.id, filePath);
      const fileName = filePath.split('/').pop() || filePath;
      
      const newTab: FileTab = {
        key: filePath,
        title: fileName,
        path: filePath,
        content: content,
        originalContent: content,
        isModified: false,
        language: getLanguageFromPath(filePath),
      };

      if (fileType === 'editor') {
        setEditorTabs(prev => {
          const existing = prev.find(t => t.key === filePath);
          if (existing) {
            setActiveEditorTab(filePath);
            return prev;
          }
          setActiveEditorTab(filePath);
          return [...prev, newTab];
        });
      } else {
        setDocumentTabs(prev => {
          const existing = prev.find(t => t.key === filePath);
          if (existing) {
            setActiveDocumentTab(filePath);
            return prev;
          }
          setActiveDocumentTab(filePath);
          return [...prev, newTab];
        });
      }
    } catch (error) {
      message.error('读取文件失败');
    }
  }, [currentProject?.id, setEditorTabs, setDocumentTabs, setActiveEditorTab, setActiveDocumentTab]);

  const handleEditorContentChange = useCallback((filePath: string, content: string) => {
    setEditorTabs(prev => prev.map(tab => {
      if (tab.key === filePath) {
        const isModified = content !== tab.originalContent;
        return { ...tab, content, isModified };
      }
      return tab;
    }));
  }, [setEditorTabs]);

  const handleDocumentContentChange = useCallback((filePath: string, content: string) => {
    setDocumentTabs(prev => prev.map(tab => {
      if (tab.key === filePath) {
        const isModified = content !== tab.originalContent;
        return { ...tab, content, isModified };
      }
      return tab;
    }));
  }, [setDocumentTabs]);

  const handleAutoSave = useCallback(async (filePath: string, content: string) => {
    if (!currentProject?.id) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await runProjectApi.saveFileContent(currentProject.id, filePath, content);
        setEditorTabs(prev => prev.map(tab => {
          if (tab.key === filePath) {
            return { ...tab, originalContent: content, isModified: false };
          }
          return tab;
        }));
      } catch (error) {
        console.warn('Auto save failed:', error);
      }
    }, 1000);
  }, [currentProject?.id, setEditorTabs]);

  const handleSaveFile = useCallback(async (filePath: string, content: string) => {
    if (!currentProject?.id) {
      message.error('请先选择项目');
      return false;
    }

    try {
      await runProjectApi.saveFileContent(currentProject.id, filePath, content);
      setEditorTabs(prev => prev.map(tab => {
        if (tab.key === filePath) {
          return { ...tab, originalContent: content, isModified: false };
        }
        return tab;
      }));
      message.success('文件已保存');
      return true;
    } catch (error) {
      message.error('保存文件失败');
      return false;
    }
  }, [currentProject?.id, setEditorTabs]);

  const handleCloseEditorTab = useCallback((filePath: string) => {
    setEditorTabs(prev => {
      const newTabs = prev.filter(t => t.key !== filePath);
      if (activeEditorTab === filePath && newTabs.length > 0) {
        setActiveEditorTab(newTabs[newTabs.length - 1].key);
      } else if (newTabs.length === 0) {
        setActiveEditorTab(null);
      }
      return newTabs;
    });
  }, [activeEditorTab, setEditorTabs, setActiveEditorTab]);

  const handleCloseDocumentTab = useCallback((filePath: string) => {
    setDocumentTabs(prev => {
      const newTabs = prev.filter(t => t.key !== filePath);
      if (activeDocumentTab === filePath && newTabs.length > 0) {
        setActiveDocumentTab(newTabs[newTabs.length - 1].key);
      } else if (newTabs.length === 0) {
        setActiveDocumentTab(null);
      }
      return newTabs;
    });
  }, [activeDocumentTab, setDocumentTabs, setActiveDocumentTab]);

  return {
    editorTabs,
    documentTabs,
    activeEditorTab,
    activeDocumentTab,
    handleFileSelect,
    handleEditorContentChange,
    handleDocumentContentChange,
    handleAutoSave,
    handleSaveFile,
    handleCloseEditorTab,
    handleCloseDocumentTab,
    setActiveEditorTab,
    setActiveDocumentTab,
  };
};

const getLanguageFromPath = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
  };
  return languageMap[ext || ''] || 'plaintext';
};
