/**
 * @file CardItem.tsx
 * @description 统一的卡片组件 - 用于AgenticFlow、Skills、MCP列表
 * @author SoloEngine Team
 * @date 2026-02-23
 */
import React from 'react';
import { Typography, Tag, Button, Popconfirm, Switch } from 'antd';
import {
  DeleteOutlined,
  PlayCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  ApiOutlined,
  DisconnectOutlined,
  CheckCircleOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export interface CardItemProps {
  id: string;
  name: string;
  description?: string;
  icon?: React.ReactNode;
  tags?: string[];
  status?: 'connected' | 'connecting' | 'error' | 'disconnected' | 'active' | 'inactive';
  statusText?: string;
  meta1?: { label: string; value: string };
  meta2?: { label: string; value: string };
  updatedAt?: string;
  isTemplate?: boolean;
  isActive?: boolean;
  showSwitch?: boolean;
  onClick?: () => void;
  onSwitchChange?: (checked: boolean) => void;
  onPlay?: () => void;
  onCopy?: () => void;
  onView?: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onDelete?: () => void;
  deleteConfirmText?: string;
  deleteWarning?: string;
}

const CardItem: React.FC<CardItemProps> = ({
  name,
  description,
  icon,
  tags = [],
  status,
  statusText,
  meta1,
  meta2,
  updatedAt,
  isTemplate,
  isActive,
  showSwitch,
  onClick,
  onSwitchChange,
  onPlay,
  onCopy,
  onView,
  onConnect,
  onDisconnect,
  onDelete,
  deleteConfirmText = '确定要删除此项吗？',
  deleteWarning,
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'connected':
      case 'active':
        return 'var(--positive)';
      case 'connecting':
        return 'var(--accent-100)';
      case 'error':
        return 'var(--negative)';
      default:
        return 'var(--bg-300)';
    }
  };

  const getStatusTagColor = () => {
    switch (status) {
      case 'connected':
        return 'success';
      case 'connecting':
        return 'processing';
      case 'error':
        return 'error';
      case 'active':
        return 'success';
      default:
        return 'default';
    }
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-100)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        boxShadow: 'var(--shadow-sm)',
        transition: 'all 0.3s',
        cursor: 'pointer',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `4px solid ${getStatusColor()}`,
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-base)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ flex: 1, marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          {icon && <span style={{ color: 'var(--primary-100)', fontSize: 14 }}>{icon}</span>}
          <Text
            ellipsis
            style={{ flex: 1, fontWeight: 600, fontSize: 15, color: 'var(--text-100)' }}
          >
            {name}
          </Text>
          {isTemplate && (
            <Tag color="blue" style={{ fontSize: '10px', margin: 0 }}>
              模板
            </Tag>
          )}
          {status && statusText && (
            <Tag color={getStatusTagColor()} style={{ fontSize: '10px', margin: 0 }}>
              {statusText}
            </Tag>
          )}
          {showSwitch && (
            <Switch
              size="small"
              checked={isActive}
              onChange={onSwitchChange}
              onClick={(e) => e.stopPropagation()}
              checkedChildren={<CheckCircleOutlined />}
            />
          )}
        </div>

        <Paragraph
          ellipsis={{ rows: 2 }}
          style={{
            marginBottom: '10px',
            minHeight: '40px',
            fontSize: 13,
            color: 'var(--text-200)',
            lineHeight: 1.5,
          }}
        >
          {description || '暂无描述'}
        </Paragraph>

        {tags.length > 0 && (
          <div style={{ marginBottom: '10px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {tags.slice(0, 3).map((tag, index) => (
              <Tag key={index} style={{ fontSize: '11px', margin: 0 }}>
                {tag}
              </Tag>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          {meta1 && (
            <Text style={{ fontSize: '12px', color: 'var(--text-200)' }}>
              {meta1.value}
            </Text>
          )}
          {meta2 && (
            <Text style={{ fontSize: '12px', color: 'var(--text-200)' }}>
              {meta2.value}
            </Text>
          )}
        </div>

        {updatedAt && (
          <Text style={{ fontSize: '12px', color: 'var(--text-200)' }}>
            {formatTime(updatedAt)}
          </Text>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '4px',
          paddingTop: '10px',
          borderTop: '1px solid var(--border-color-light)',
        }}
      >
        {onPlay && (
          <Button
            type="text"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            style={{ color: 'var(--accent-100)' }}
          />
        )}
        {onCopy && (
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            style={{ color: 'var(--text-200)' }}
          />
        )}
        {onView && (
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
            style={{ color: 'var(--accent-100)' }}
          />
        )}
        {onConnect && status !== 'connected' && (
          <Button
            type="text"
            size="small"
            icon={<ApiOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onConnect();
            }}
            style={{ color: 'var(--accent-100)' }}
          />
        )}
        {onDisconnect && status === 'connected' && (
          <Button
            type="text"
            size="small"
            icon={<DisconnectOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onDisconnect();
            }}
            style={{ color: 'var(--text-200)' }}
          />
        )}
        {onDelete && (
          <Popconfirm
            title={
              <div>
                <div>{deleteConfirmText}</div>
                {deleteWarning && (
                  <div style={{ color: 'var(--negative)', fontSize: 12, marginTop: 4 }}>
                    ⚠️ {deleteWarning}
                  </div>
                )}
              </div>
            }
            onConfirm={(e) => {
              e?.stopPropagation();
              onDelete();
            }}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => e.stopPropagation()}
            />
          </Popconfirm>
        )}
      </div>
    </div>
  );
};

export default CardItem;
