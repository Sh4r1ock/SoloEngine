import React from 'react';
import { Typography, Tag, Button, Popconfirm, Switch } from 'antd';
import {
  PlayCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { formatTime as formatTimezone } from '../../utils/timezone';

const { Text, Paragraph } = Typography;

export interface CardItemProps {
  name: string;
  description?: string;
  icon?: React.ReactNode;
  tags?: string[];
  status?: string;
  statusText?: string;
  isTemplate?: boolean;
  isActive?: boolean;
  isDefault?: boolean;
  meta1?: { label: string; value: string };
  meta2?: { label: string; value: string };
  updatedAt?: string;
  showSwitch?: boolean;
  onPlay?: (e?: React.MouseEvent) => void;
  onCopy?: () => void;
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSwitchChange?: (checked: boolean) => void;
  onClick?: (e?: React.MouseEvent) => void;
  deleteConfirmText?: string;
  deleteWarning?: string;
}

const getStatusColor = (status?: string) => {
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

const getStatusTagColor = (status?: string) => {
  switch (status) {
    case 'connected':
    case 'active':
      return 'success';
    case 'connecting':
      return 'processing';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
};

const formatTime = (dateStr?: string) => {
  return formatTimezone(dateStr);
};

const UnifiedCard: React.FC<CardItemProps> = ({
  name,
  description,
  icon,
  tags = [],
  status,
  statusText,
  isTemplate,
  isActive,
  isDefault,
  meta1,
  meta2,
  updatedAt,
  showSwitch,
  onPlay,
  onCopy,
  onView,
  onEdit,
  onDelete,
  onSwitchChange,
  onClick,
  deleteConfirmText = '确定要删除此项吗？',
  deleteWarning,
}) => {
  return (
    <div
      style={{
        background: 'var(--bg-100)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        boxShadow: 'var(--shadow-sm)',
        transition: 'all 0.3s',
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `4px solid ${isDefault ? 'var(--primary-100)' : getStatusColor(status || (isActive ? 'active' : undefined))}`,
      }}
      onClick={(e) => onClick?.(e)}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.boxShadow = 'var(--shadow-base)';
          e.currentTarget.style.transform = 'translateY(-2px)';
        }
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
          {isDefault && (
            <Tag color="purple" style={{ fontSize: '10px', margin: 0 }}>
              默认
            </Tag>
          )}
          {status && statusText && (
            <Tag color={getStatusTagColor(status)} style={{ fontSize: '10px', margin: 0 }}>
              {statusText}
            </Tag>
          )}
          {showSwitch && (
            <Switch
              size="small"
              checked={isActive}
              onChange={onSwitchChange}
              onClick={(checked, e) => e?.stopPropagation?.()}
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
              onPlay(e as unknown as React.MouseEvent);
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
        {onEdit && (
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            style={{ color: 'var(--primary-100)' }}
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

export default UnifiedCard;
