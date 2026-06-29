/**
 * @file components/QueueBar.tsx
 * @description 消息队列栏 - 保留标题栏 + CSS border转圈前置 + 白底 + 极浅实线分隔
 */
import React, { useState } from 'react';
import { Tooltip } from 'antd';
import { ClockCircleOutlined, DeleteOutlined } from '@ant-design/icons';

interface QueueBarProps {
  messages: string[];
  onRemove: (index: number) => void;
}

const QueueBar: React.FC<QueueBarProps> = ({ messages, onRemove }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div style={{
      flexShrink: 0,
      padding: '8px 14px 0',
      background: 'var(--bg-100)',
      borderTop: '1px solid var(--bg-300)',
      maxHeight: '200px',
      overflowY: 'auto',
    }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 2,
        paddingBottom: 4,
        borderBottom: '1px solid var(--bg-200)',
      }}>
        <ClockCircleOutlined style={{ fontSize: 13, color: 'var(--primary-100)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
          排队消息 ({messages.length})
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-300)' }}>
          · 等待当前任务完成后自动发送
        </span>
      </div>

      {/* 消息列表 - CSS border转圈前置 + 极浅实线分隔 */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {messages.map((msg, idx) => {
          const isHovered = hoveredIdx === idx;
          const isLast = idx === messages.length - 1;
          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderBottom: isLast ? 'none' : '1px solid var(--bg-400)',
                cursor: 'default',
                transition: 'background-color 0.15s ease, border-color 0.15s ease',
                backgroundColor: isHovered ? 'var(--bg-200)' : 'transparent',
                margin: '0 -10px',
                borderRadius: isHovered ? 6 : 0,
              }}
            >
              {/* CSS border 转圈 - 参考MessageList"正在思考"转圈 */}
              <div style={{
                width: 14,
                height: 14,
                border: '2px solid var(--bg-300)',
                borderTopColor: 'var(--primary-100)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                flexShrink: 0,
                boxSizing: 'border-box',
              }} />

              {/* 消息内容 - 单行省略 */}
              <div style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
                color: 'var(--text-100)',
                lineHeight: 1.5,
              }}>
                {msg}
              </div>

              {/* 删除按钮 - hover 显示 */}
              <Tooltip title="移除">
                <button
                  onClick={() => onRemove(idx)}
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--text-300)',
                    opacity: isHovered ? 1 : 0,
                    transition: 'opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--error-color)';
                    e.currentTarget.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-300)';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <DeleteOutlined style={{ fontSize: 12 }} />
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default QueueBar;
