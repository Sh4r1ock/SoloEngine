import { useEffect, useCallback } from 'react';
import type { FileTab } from '../types';

interface UseEditorShortcutsProps {
  activeTab: FileTab | null;
  onSave: (tab: FileTab) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFind?: () => void;
  onReplace?: () => void;
}

export const useEditorShortcuts = ({
  activeTab,
  onSave,
  onUndo,
  onRedo,
  onFind,
  onReplace,
}: UseEditorShortcutsProps) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!activeTab) return;

    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key === 's') {
      e.preventDefault();
      onSave(activeTab);
      return;
    }

    if (isMod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      onUndo?.();
      return;
    }

    if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      onRedo?.();
      return;
    }

    if (isMod && e.key === 'f') {
      e.preventDefault();
      onFind?.();
      return;
    }

    if (isMod && e.key === 'h') {
      e.preventDefault();
      onReplace?.();
      return;
    }
  }, [activeTab, onSave, onUndo, onRedo, onFind, onReplace]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};
