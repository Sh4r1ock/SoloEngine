/**
 * @file components/FileDiffViewer.tsx
 * @description 文件差异对比组件 - 显示文件修改前后的差异
 */

import React, { useMemo, useRef, useCallback } from 'react';
import { Button, Space, Typography, Tooltip } from 'antd';
import {
  FileOutlined,
  ArrowRightOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import '../styles/FileChangeStyles.css';

const { Text } = Typography;

interface DiffLine {
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldContent: string;
  newContent: string;
  type: 'unchanged' | 'added' | 'removed' | 'modified';
}

interface DiffRow {
  type: 'unchanged' | 'removed-only' | 'added-only' | 'modified';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldContent: string;
  newContent: string;
}

interface FileDiffViewerProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  onApply?: () => void;
  onRevert?: () => void;
  onApplyLine?: (lineNumber: number, content: string) => void;
  onRevertLine?: (lineNumber: number, content: string) => void;
  hideHeader?: boolean;
}

const computeDiff = (oldText: string, newText: string): DiffLine[] => {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];

  const oldLen = oldLines.length;
  const newLen = newLines.length;

  const lcs: number[][] = Array(oldLen + 1)
    .fill(null)
    .map(() => Array(newLen + 1).fill(0));

  for (let i = 1; i <= oldLen; i++) {
    for (let j = 1; j <= newLen; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  let i = oldLen;
  let j = newLen;
  const diffLines: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffLines.unshift({
        oldLineNumber: i,
        newLineNumber: j,
        oldContent: oldLines[i - 1],
        newContent: newLines[j - 1],
        type: 'unchanged',
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      diffLines.unshift({
        oldLineNumber: null,
        newLineNumber: j,
        oldContent: '',
        newContent: newLines[j - 1],
        type: 'added',
      });
      j--;
    } else if (i > 0) {
      diffLines.unshift({
        oldLineNumber: i,
        newLineNumber: null,
        oldContent: oldLines[i - 1],
        newContent: '',
        type: 'removed',
      });
      i--;
    }
  }

  return diffLines;
};

const pairDiffLines = (diffLines: DiffLine[]): DiffRow[] => {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < diffLines.length) {
    if (diffLines[i].type === 'unchanged') {
      rows.push({
        type: 'unchanged',
        oldLineNumber: diffLines[i].oldLineNumber,
        newLineNumber: diffLines[i].newLineNumber,
        oldContent: diffLines[i].oldContent,
        newContent: diffLines[i].newContent,
      });
      i++;
    } else {
      const removedLines: DiffLine[] = [];
      const addedLines: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type !== 'unchanged') {
        if (diffLines[i].type === 'removed') {
          removedLines.push(diffLines[i]);
        } else if (diffLines[i].type === 'added') {
          addedLines.push(diffLines[i]);
        }
        i++;
      }
      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < maxLen; j++) {
        const removed = removedLines[j];
        const added = addedLines[j];
        if (removed && added) {
          rows.push({
            type: 'modified',
            oldLineNumber: removed.oldLineNumber,
            newLineNumber: added.newLineNumber,
            oldContent: removed.oldContent,
            newContent: added.newContent,
          });
        } else if (removed) {
          rows.push({
            type: 'removed-only',
            oldLineNumber: removed.oldLineNumber,
            newLineNumber: null,
            oldContent: removed.oldContent,
            newContent: '',
          });
        } else if (added) {
          rows.push({
            type: 'added-only',
            oldLineNumber: null,
            newLineNumber: added.newLineNumber,
            oldContent: '',
            newContent: added.newContent,
          });
        }
      }
    }
  }
  return rows;
};

const calcNumWidth = (lineCount: number): number => {
  const digits = Math.max(String(Math.max(lineCount, 1)).length, 2);
  return digits * 9 + 10;
};

const FileDiffViewer: React.FC<FileDiffViewerProps> = ({
  filePath,
  oldContent,
  newContent,
  onApply,
  onRevert,
  onApplyLine,
  onRevertLine,
  hideHeader,
}) => {
  const diffLines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);
  const diffRows = useMemo(() => pairDiffLines(diffLines), [diffLines]);

  const stats = useMemo(() => {
    const added = diffLines.filter(l => l.type === 'added').length;
    const removed = diffLines.filter(l => l.type === 'removed').length;
    return { added, removed };
  }, [diffLines]);

  const handleApplyAll = () => {
    if (onApply) {
      onApply();
    }
  };

  const handleRevertAll = () => {
    if (onRevert) {
      onRevert();
    }
  };

  const oldLineCount = oldContent ? oldContent.split('\n').length : 0;
  const newLineCount = newContent ? newContent.split('\n').length : 0;
  const oldNumWidth = calcNumWidth(oldLineCount);
  const newNumWidth = calcNumWidth(newLineCount);

  const leftContentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rightContentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const isSyncingLeft = useRef(false);
  const isSyncingRight = useRef(false);

  const syncLeftContentScroll = useCallback((sourceIndex: number, scrollLeft: number) => {
    if (isSyncingLeft.current) return;
    isSyncingLeft.current = true;
    leftContentRefs.current.forEach((el, i) => {
      if (i !== sourceIndex && el) {
        el.scrollLeft = scrollLeft;
      }
    });
    requestAnimationFrame(() => { isSyncingLeft.current = false; });
  }, []);

  const syncRightContentScroll = useCallback((sourceIndex: number, scrollLeft: number) => {
    if (isSyncingRight.current) return;
    isSyncingRight.current = true;
    rightContentRefs.current.forEach((el, i) => {
      if (i !== sourceIndex && el) {
        el.scrollLeft = scrollLeft;
      }
    });
    requestAnimationFrame(() => { isSyncingRight.current = false; });
  }, []);

  return (
    <div className="sc-diff-viewer">
      {!hideHeader && (
      <div className="sc-diff-header">
        <div className="sc-diff-header-left">
          <FileOutlined className="sc-diff-header-file-icon" />
          <Text className="sc-diff-header-path">
            {filePath}
          </Text>
          <div className="sc-diff-header-stats">
            <span className="sc-diff-stat added">+{stats.added}</span>
            <span className="sc-diff-stat removed">-{stats.removed}</span>
          </div>
        </div>
        <div className="sc-diff-actions">
          <Space size={4}>
            <Tooltip title="一键应用所有更改（覆盖旧内容）">
              <Button
                type="primary"
                size="small"
                icon={<ArrowRightOutlined />}
                onClick={handleApplyAll}
                disabled={!onApply}
                style={{
                  borderRadius: 4,
                  fontSize: 12,
                  height: 26,
                }}
              >
                应用全部
              </Button>
            </Tooltip>
            <Tooltip title="一键撤销所有更改（恢复旧内容）">
              <Button
                size="small"
                icon={<ArrowLeftOutlined />}
                onClick={handleRevertAll}
                disabled={!onRevert}
                style={{
                  borderRadius: 4,
                  fontSize: 12,
                  height: 26,
                }}
              >
                撤销全部
              </Button>
            </Tooltip>
          </Space>
        </div>
      </div>
      )}

      <div className="sc-diff-col-header">
        <div className="sc-diff-col-header-spacer" style={{ width: oldNumWidth, minWidth: oldNumWidth }} />
        <div className="sc-diff-col-header-cell">
          <Text className="sc-diff-col-header-label">原始内容</Text>
          <Text className="sc-diff-col-header-count">({oldLineCount} 行)</Text>
        </div>
        <div className="sc-diff-col-header-spacer" style={{ width: newNumWidth, minWidth: newNumWidth }} />
        <div className="sc-diff-col-header-cell">
          <Text className="sc-diff-col-header-label">新内容</Text>
          <Text className="sc-diff-col-header-count">({newLineCount} 行)</Text>
        </div>
      </div>

      <div className="sc-diff-body">
        {diffRows.map((row, index) => {
          const oldNumClass = [
            row.type === 'removed-only' ? 'removed' : '',
            row.type === 'modified' ? 'modified-old' : '',
          ].filter(Boolean).join(' ');

          const oldContentClass = [
            row.type === 'removed-only' ? 'removed' : '',
            row.type === 'modified' ? 'modified-old' : '',
          ].filter(Boolean).join(' ');

          const newNumClass = [
            row.type === 'added-only' ? 'added' : '',
            row.type === 'modified' ? 'modified-new' : '',
          ].filter(Boolean).join(' ');

          const newContentClass = [
            row.type === 'added-only' ? 'added' : '',
            row.type === 'modified' ? 'modified-new' : '',
          ].filter(Boolean).join(' ');

          return (
            <div key={index} className="sc-diff-row">
              <div
                className={`sc-diff-line-num ${oldNumClass}`}
                style={{ width: oldNumWidth, minWidth: oldNumWidth }}
              >
                {row.oldLineNumber || ''}
              </div>
              <div
                className={`sc-diff-line-content ${oldContentClass}`}
                ref={(el) => {
                  if (el) leftContentRefs.current.set(index, el);
                  else leftContentRefs.current.delete(index);
                }}
                onScroll={(e) => syncLeftContentScroll(index, e.currentTarget.scrollLeft)}
              >
                {row.oldContent || '\u00A0'}
              </div>
              <div
                className={`sc-diff-line-num ${newNumClass}`}
                style={{ width: newNumWidth, minWidth: newNumWidth }}
              >
                {row.newLineNumber || ''}
              </div>
              <div
                className={`sc-diff-line-content ${newContentClass}`}
                ref={(el) => {
                  if (el) rightContentRefs.current.set(index, el);
                  else rightContentRefs.current.delete(index);
                }}
                onScroll={(e) => syncRightContentScroll(index, e.currentTarget.scrollLeft)}
              >
                {row.newContent || '\u00A0'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FileDiffViewer;
