import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { history } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';
import { getLanguage } from '../utils/fileTypeUtils';
import { loadLanguage } from './lazyLanguageLoader';

import type { Extension } from '@codemirror/state';

interface CodeEditorProps {
  instanceId: string;
  tab: FileTab;
  canEdit?: boolean;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  instanceId,
  tab,
  canEdit = true,
  onContentChange,
  onSave,
}) => {
  const { addTimer, removeTimer, cleanup } = useEditorInstanceManager(instanceId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = getLanguage(tab.name) || 'javascript';
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLangExtension = async () => {
      setLoading(true);
      const ext = await loadLanguage(language);
      setLanguageExtension(ext);
      setLoading(false);
    };
    
    loadLangExtension();
  }, [language]);

  const extensions = useMemo(() => {
    const exts: Extension[] = [history(), oneDark];
    if (languageExtension) {
      exts.unshift(languageExtension);
    }
    return exts;
  }, [languageExtension]);

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
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tab, onSave]);

  useEditorCleanup(instanceId, cleanup);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%',
        background: '#1e1e1e',
        color: '#888'
      }}>
        加载编辑器...
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#1e1e1e' }}>
      <CodeMirror
        value={tab.content}
        height="100%"
        extensions={extensions}
        onChange={handleChange}
        theme="dark"
        editable={canEdit}
        style={{ 
          height: '100%', 
          fontSize: 13,
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        }}
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
  );
};

export default CodeEditor;
