/**
 * @file components/MessageInput.tsx
 * @description 消息输入组件
 */

import React from 'react';
import { Button, Input } from 'antd';
import { SendOutlined } from '@ant-design/icons';

const { TextArea } = Input;

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isRunning: boolean;
  disabled?: boolean;
}

const MessageInput: React.FC<MessageInputProps> = ({
  value,
  onChange,
  onSend,
  onStop,
  isRunning,
  disabled,
}) => {
  return (
    <div style={{
      flexShrink: 0,
      padding: '12px',
      background: 'var(--bg-100)',
    }}>
      <div style={{
        background: 'var(--bg-100)',
        borderRadius: 6,
        border: '1px solid var(--bg-300)',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease',
      }}>
        <TextArea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入消息..."
          autoSize={{ minRows: 1, maxRows: 6 }}
          variant="borderless"
          disabled={disabled}
          style={{
            resize: 'none',
            background: 'transparent',
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--text-100)',
            padding: '12px 14px',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
          }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '8px 12px',
        }}>
          {isRunning ? (
            <Button
              type="primary"
              size="small"
              icon={
                <div style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: '2px solid #fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <div style={{
                    width: 7,
                    height: 7,
                    background: '#fff',
                  }} />
                </div>
              }
              onClick={onStop}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                border: 'none',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          ) : (
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined style={{ fontSize: 14 }} />}
              onClick={onSend}
              disabled={!value.trim() || disabled}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: value.trim() && !disabled
                  ? 'linear-gradient(135deg, var(--primary-100), var(--primary-200))'
                  : 'var(--bg-300)',
                border: 'none',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageInput;
