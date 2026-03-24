/**
 * @file components/FileDiffViewer.tsx
 * @description 文件差异对比组件 - 显示文件修改前后的差异
 */

import React, { useMemo, useState } from 'react';
import { Button, Space, Typography, Tooltip } from 'antd';
import {
  CheckOutlined,
  UndoOutlined,
  FileOutlined,
  ArrowRightOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface DiffLine {
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldContent: string;
  newContent: string;
  type: 'unchanged' | 'added' | 'removed' | 'modified';
}

interface FileDiffViewerProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  onApply?: () => void;
  onRevert?: () => void;
  onApplyLine?: (lineNumber: number, content: string) => void;
  onRevertLine?: (lineNumber: number, content: string) => void;
}

const computeDiff = (oldText: string, newText: string): DiffLine[] => {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

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

const DiffLineComponent: React.FC<{
  diffLine: DiffLine;
  side: 'old' | 'new';
  onApplyLine?: () => void;
  onRevertLine?: () => void;
}> = ({ diffLine, side, onApplyLine, onRevertLine }) => {
  const [isHovered, setIsHovered] = useState(false);

  const isOld = side === 'old';
  const lineNumber = isOld ? diffLine.oldLineNumber : diffLine.newLineNumber;
  const content = isOld ? diffLine.oldContent : diffLine.newContent;
  const isDiff = diffLine.type !== 'unchanged';

  const getBgColor = () => {
    if (diffLine.type === 'removed' && isOld) {
      return 'rgba(255, 85, 85, 0.15)';
    }
    if (diffLine.type === 'added' && !isOld) {
      return 'rgba(82, 196, 26, 0.15)';
    }
    return 'transparent';
  };

  const getBorderColor = () => {
    if (diffLine.type === 'removed' && isOld) {
      return '2px solid rgba(255, 85, 85, 0.5)';
    }
    if (diffLine.type === 'added' && !isOld) {
      return '2px solid rgba(82, 196, 26, 0.5)';
    }
    return 'none';
  };

  const getTextColor = () => {
    if (diffLine.type === 'removed' && isOld) {
      return '#ff4d4f';
    }
    if (diffLine.type === 'added' && !isOld) {
      return '#52c41a';
    }
    return 'var(--text-100)';
  };

  const showActionButtons = isHovered && isDiff && (
    (isOld && diffLine.type === 'removed') || 
    (!isOld && diffLine.type === 'added')
  );

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: getBgColor(),
        borderLeft: getBorderColor(),
        minHeight: 22,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: 50,
          minWidth: 50,
          padding: '2px 8px',
          textAlign: 'right',
          background: 'var(--bg-200)',
          color: 'var(--text-300)',
          fontSize: 12,
          fontFamily: 'var(--font-family-code)',
          userSelect: 'none',
          borderRight: '1px solid var(--bg-300)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        {lineNumber || ''}
      </div>
      <div
        style={{
          flex: 1,
          padding: '2px 12px',
          fontFamily: 'var(--font-family-code)',
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: getTextColor(),
          position: 'relative',
        }}
      >
        {diffLine.type === 'removed' && isOld && (
          <span style={{ marginRight: 8, color: '#ff4d4f' }}>-</span>
        )}
        {diffLine.type === 'added' && !isOld && (
          <span style={{ marginRight: 8, color: '#52c41a' }}>+</span>
        )}
        {content || ' '}
        
        {showActionButtons && (
          <div
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              gap: 4,
              background: 'var(--bg-100)',
              borderRadius: 4,
              padding: '2px 4px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            }}
          >
            {isOld && diffLine.type === 'removed' && onRevertLine && (
              <Tooltip title="撤销此行删除（恢复此行）">
                <Button
                  type="text"
                  size="small"
                  icon={<UndoOutlined />}
                  onClick={onRevertLine}
                  style={{
                    width: 22,
                    height: 22,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ff4d4f',
                  }}
                />
              </Tooltip>
            )}
            {!isOld && diffLine.type === 'added' && onApplyLine && (
              <Tooltip title="应用此行新增">
                <Button
                  type="text"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={onApplyLine}
                  style={{
                    width: 22,
                    height: 22,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#52c41a',
                  }}
                />
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const FileDiffViewer: React.FC<FileDiffViewerProps> = ({
  filePath,
  oldContent,
  newContent,
  onApply,
  onRevert,
  onApplyLine,
  onRevertLine,
}) => {
  const diffLines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);

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

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-100)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--bg-300)',
          background: 'var(--bg-200)',
        }}
      >
        <Space size={8}>
          <FileOutlined style={{ color: 'var(--primary-100)' }} />
          <Text strong style={{ fontSize: 13 }}>
            {filePath}
          </Text>
          {stats.added > 0 && (
            <Text style={{ fontSize: 12, color: '#52c41a' }}>
              +{stats.added}
            </Text>
          )}
          {stats.removed > 0 && (
            <Text style={{ fontSize: 12, color: '#ff4d4f' }}>
              -{stats.removed}
            </Text>
          )}
        </Space>
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

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--bg-300)',
            background: 'var(--bg-200)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div
            style={{
              flex: 1,
              padding: '6px 12px',
              borderRight: '1px solid var(--bg-300)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text strong style={{ fontSize: 12, color: 'var(--text-200)' }}>
              原始内容
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              ({oldContent.split('\n').length} 行)
            </Text>
          </div>
          <div
            style={{
              flex: 1,
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text strong style={{ fontSize: 12, color: 'var(--text-200)' }}>
              新内容
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              ({newContent.split('\n').length} 行)
            </Text>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1 }}>
          <div
            style={{
              flex: 1,
              borderRight: '1px solid var(--bg-300)',
              overflow: 'hidden',
            }}
          >
            {diffLines.map((line, index) => (
              <DiffLineComponent
                key={`old-${index}`}
                diffLine={line}
                side="old"
                onRevertLine={
                  line.type === 'removed' && onRevertLine
                    ? () => onRevertLine(line.oldLineNumber!, line.oldContent)
                    : undefined
                }
              />
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {diffLines.map((line, index) => (
              <DiffLineComponent
                key={`new-${index}`}
                diffLine={line}
                side="new"
                onApplyLine={
                  line.type === 'added' && onApplyLine
                    ? () => onApplyLine(line.newLineNumber!, line.newContent)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileDiffViewer;
