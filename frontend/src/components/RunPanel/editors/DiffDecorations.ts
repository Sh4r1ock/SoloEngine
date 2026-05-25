import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { useRunPanelStore } from '../stores/runPanelStore';
import { fileChangesApi } from '../../../services/fileChangesApi';

const setLineDecorations = StateEffect.define<number[]>();

const lineDecorationField = StateField.define<RangeSet<Decoration>>({
  create() {
    return RangeSet.empty;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setLineDecorations)) {
        const decoList = e.value
          .filter((lineNo) => lineNo >= 1 && lineNo <= tr.state.doc.lines)
          .map((lineNo) => {
            const line = tr.state.doc.line(lineNo);
            return Decoration.line({ attributes: { class: 'sc-diff-line-added' } }).range(line.from);
          });
        return RangeSet.of(decoList, true);
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

let pendingLineNumbers: number[] = [];
let dispatchQueue: EditorView[] = [];

function scheduleDispatch(view: EditorView) {
  if (!dispatchQueue.includes(view)) {
    dispatchQueue.push(view);
  }
  if (dispatchQueue.length === 1) {
    requestAnimationFrame(() => {
      const views = dispatchQueue;
      dispatchQueue = [];
      const nums = pendingLineNumbers;
      for (const v of views) {
        if (v.viewport) {
          v.dispatch({ effects: [setLineDecorations.of(nums)] });
        }
      }
    });
  }
}

const diffPlugin = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {
    scheduleDispatch(view);
  }

  update(update: ViewUpdate) {
    scheduleDispatch(update.view);
  }

  destroy() {}
});

interface UseDiffDecorationsResult {
  extensions: Extension[];
  hasPendingDiff: boolean;
}

export function useDiffDecorations(filePath: string): UseDiffDecorationsResult {
  const currentSessionId = useRunPanelStore((s) => s.currentSessionId);
  const fileChangeRefreshKey = useRunPanelStore((s) => s.fileChangeRefreshKey);
  const [hasPendingDiff, setHasPendingDiff] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const fetchDiff = useCallback(async () => {
    if (!currentSessionId || !filePath) {
      pendingLineNumbers = [];
      setHasPendingDiff(false);
      return;
    }

    fetchAbortRef.current?.abort();
    fetchAbortRef.current = new AbortController();

    try {
      const response = await fileChangesApi.getFileDiffHunks(currentSessionId, filePath, 'pending');
      if (!response || response.code !== 200 || !response.data?.changes) {
        pendingLineNumbers = [];
        setHasPendingDiff(false);
        return;
      }

      const lineNos: number[] = [];
      for (const change of response.data.changes) {
        const hunks = change.diff_data?.hunks;
        if (!hunks || !Array.isArray(hunks)) continue;
        for (const hunk of hunks) {
          if (!hunk.lines || !Array.isArray(hunk.lines)) continue;
          for (const line of hunk.lines) {
            if (line.type === 'added' && line.new_line) {
              lineNos.push(line.new_line);
            }
          }
        }
      }

      pendingLineNumbers = lineNos;
      setHasPendingDiff(lineNos.length > 0);
    } catch {
      pendingLineNumbers = [];
      setHasPendingDiff(false);
    }
  }, [currentSessionId, filePath]);

  useEffect(() => {
    fetchDiff();
    return () => {
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
    };
  }, [fetchDiff, fileChangeRefreshKey]);

  const extensions = useMemo(() => [lineDecorationField, diffPlugin], []);

  return { extensions, hasPendingDiff };
}