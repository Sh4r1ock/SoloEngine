import React, { useCallback, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface TextViewerProps {
  instanceId: string;
  tab: FileTab;
  canEdit?: boolean;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

const TextViewer: React.FC<TextViewerProps> = ({
  instanceId,
  tab,
  canEdit = true,
  onContentChange,
  onSave,
}) => {
  const { addTimer, removeTimer, addEventListener, cleanup } = useEditorInstanceManager(instanceId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [tab, onContentChange, onSave, addTimer, removeTimer]);

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

  return (
    <div className="doc-editor-wrapper" style={{ height: '100%', overflow: 'hidden', background: '#1e1e1e' }}>
      <CodeMirror
        value={tab.content}
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
          drawSelection: true,
        }}
      />
    </div>
  );
};

export default TextViewer;
