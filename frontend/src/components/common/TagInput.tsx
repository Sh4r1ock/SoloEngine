/**
 * @file TagInput.tsx
 * @description F4：标签输入公共组件
 * - 收敛 MCPAddServerModal / SkillsManager / SkillsCreateModal / SkillsImportDialog 4 处内联实现
 * - 统一行为：回车/失焦添加（非空 + 去重）、Tag 可关闭、system 标签特殊高亮
 */
import React, { useState } from 'react';
import { Tag, Input } from 'antd';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

const TagInput: React.FC<TagInputProps> = ({ value, onChange, placeholder = '按回车添加标签' }) => {
  const [inputValue, setInputValue] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleConfirm = () => {
    if (inputValue && !value.includes(inputValue)) {
      onChange([...value, inputValue]);
    }
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  const handleRemove = (removedTag: string) => {
    onChange(value.filter(tag => tag !== removedTag));
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        alignItems: 'center',
        padding: '1px 11px',
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        minHeight: 30,
        backgroundColor: '#fff',
        fontSize: 14,
        transition: 'all 0.2s',
        cursor: 'text',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#4096ff';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#d9d9d9';
      }}
      onClick={(e) => {
        // 点击容器时聚焦到输入框
        const input = e.currentTarget.querySelector('input');
        if (input) {
          input.focus();
        }
      }}
    >
      {value.map(tag => (
        <Tag
          key={tag}
          closable
          onClose={(e) => {
            e.stopPropagation();
            handleRemove(tag);
          }}
          style={{
            margin: 0,
            padding: '0 7px',
            fontSize: 14,
            lineHeight: '20px',
            borderRadius: 4,
            backgroundColor: tag === 'system' ? 'var(--primary-300)' : undefined,
            border: tag === 'system' ? '1px solid var(--primary-100)' : undefined,
            color: tag === 'system' ? 'var(--primary-100)' : undefined,
          }}
        >
          {tag}
        </Tag>
      ))}
      <Input
        type="text"
        style={{
          width: value.length === 0 ? 120 : 80,
          border: 'none',
          backgroundColor: 'transparent',
          boxShadow: 'none',
          padding: 0,
          fontSize: 14,
          lineHeight: '20px',
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleConfirm}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export default TagInput;
