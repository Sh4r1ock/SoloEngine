import React, { useState, useRef, useEffect } from 'react';
import { Popconfirm, Tooltip, Switch } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { formatTime as formatTimezone } from '../../utils/timezone';
import IconSelector from './IconSelector';

export interface CardItemProps {
  id?: string;
  name: string;
  description?: string;
  icon?: string;
  tags?: string[];
  status?: string;
  statusText?: string;
  isTemplate?: boolean;
  isActive?: boolean;
  isSystem?: boolean;
  meta1?: any;
  meta2?: any;
  updatedAt?: string;
  showSwitch?: boolean;
  showIconSelector?: boolean;
  onPlay?: any;
  onCopy?: any;
  onView?: any;
  onEdit?: any;
  onDelete?: any;
  onSwitchChange?: any;
  onIconChange?: any;
  onClick?: any;
  deleteConfirmText?: string;
  deleteWarning?: string;
}

function formatTime(dateStr?: string) {
  return formatTimezone(dateStr);
}

const UnifiedCard: React.FC<CardItemProps> = ({
  id,
  name,
  description,
  icon,
  tags = [],
  status,
  statusText,
  isTemplate,
  isActive,
  isSystem,
  meta1,
  meta2,
  updatedAt,
  showSwitch,
  showIconSelector = true,
  onPlay,
  onCopy,
  onView,
  onEdit,
  onDelete,
  onSwitchChange,
  onIconChange,
  onClick,
  deleteConfirmText = '确定要删除此项吗？',
  deleteWarning,
}) => {
  const systemTag = isSystem;
  const [nameTruncated, setNameTruncated] = useState(false);
  const [descTruncated, setDescTruncated] = useState(false);
  const nameRef = useRef<HTMLSpanElement>(null);
  const descRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const checkTruncation = () => {
      if (nameRef.current) {
        setNameTruncated(nameRef.current.scrollWidth > nameRef.current.clientWidth);
      }
      if (descRef.current) {
        setDescTruncated(descRef.current.scrollHeight > descRef.current.clientHeight);
      }
    };
    checkTruncation();
    window.addEventListener('resize', checkTruncation);
    return () => window.removeEventListener('resize', checkTruncation);
  }, [name, description]);

  const isMCPConnected = status === 'connected';

  function handleCardClick(e: React.MouseEvent) {
    onClick?.(e);
  }

  return (
    <div
      className="unified-card"
      onClick={handleCardClick}
      style={{
        background: 'var(--bg-100)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px',
        boxShadow: 'var(--shadow-sm)',
        transition: 'all var(--duration-base) var(--ease-in-out)',
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
        minHeight: '150px',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border-color-light)',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'var(--primary-300)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'var(--border-color-light)';
      }}
    >
      <div className="card-content" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="card-header" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '8px',
          flexShrink: 0,
        }}>
          {showIconSelector && onIconChange ? (
            <IconSelector
              currentIcon={icon}
              onIconSelect={onIconChange}
            />
          ) : (
            <div className="card-icon" style={{
              width: '44px',
              height: '44px',
              borderRadius: 'var(--radius-base)',
              backgroundColor: 'var(--bg-tertiary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary-100)',
              fontSize: '20px',
              flexShrink: 0,
              border: '1px solid var(--border-color-lighter)',
            }}>
              {icon || '📋'}
            </div>
          )}

          <div className="card-title-area" style={{ flex: 1, minWidth: 0 }}>
            {nameTruncated ? (
              <Tooltip title={name}>
                <span ref={nameRef} className="card-title" style={{
                  fontWeight: 600,
                  fontSize: '15px',
                  color: 'var(--text-100)',
                  lineHeight: 1.4,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {name}
                </span>
              </Tooltip>
            ) : (
              <span ref={nameRef} className="card-title" style={{
                fontWeight: 600,
                fontSize: '15px',
                color: 'var(--text-100)',
                lineHeight: 1.4,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {name}
              </span>
            )}
          </div>

          {showSwitch && (
            <Tooltip title={isActive ? '已开启' : '已关闭'}>
              <Switch
                size="small"
                checked={isActive || false}
                onChange={onSwitchChange}
                onClick={(checked, e) => e?.stopPropagation?.()}
                checkedChildren={<CheckCircleOutlined />}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>
          )}
        </div>

        {descTruncated ? (
          <Tooltip title={description}>
            <p ref={descRef} className="card-description" style={{
              margin: 0,
              minHeight: '46px',
              maxHeight: '46px',
              fontSize: '13px',
              color: 'var(--text-200)',
              lineHeight: 1.7,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              flexShrink: 0,
            }}>
              {description}
            </p>
          </Tooltip>
        ) : (
          <p ref={descRef} className="card-description" style={{
            margin: 0,
            minHeight: '46px',
            maxHeight: '46px',
            fontSize: '13px',
            color: 'var(--text-200)',
            lineHeight: 1.7,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            {description}
          </p>
        )}

        <div className="card-tags" style={{
          marginTop: '8px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          minHeight: '18px',
          flexShrink: 0,
        }}>
          {[...(systemTag ? ['system'] : []), ...tags.filter(t => t !== 'system')].slice(0, 2).map((tag, index) => (
            <span
              key={index}
              className={`card-tag ${tag === 'system' ? 'system-tag' : ''}`}
              style={{
                fontSize: '11px',
                padding: '3px 9px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: tag === 'system' ? 'var(--primary-300)' : 'var(--bg-tertiary)',
                border: `1px solid ${tag === 'system' ? 'var(--primary-100)' : 'var(--border-color-lighter)'}`,
                color: tag === 'system' ? 'var(--primary-100)' : 'var(--text-200)',
                fontWeight: 500,
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="card-meta" style={{
          marginTop: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
          flexShrink: 0,
        }}>
          {(meta1 || meta2) && (
            <div className="card-meta-row" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              {meta1 && (
                <span className="card-meta-text" style={{
                  fontSize: '12px',
                  color: 'var(--text-300)',
                }}>
                  <span className="card-meta-label" style={{
                    color: 'var(--text-300)',
                    fontWeight: 500,
                  }}>{meta1.label}：</span>{meta1.value}
                </span>
              )}
              {meta2 && (
                <span className="card-meta-text" style={{
                  fontSize: '12px',
                  color: 'var(--text-300)',
                }}>
                  <span className="card-meta-label" style={{
                    color: 'var(--text-300)',
                    fontWeight: 500,
                  }}>{meta2.label}：</span>{meta2.value}
                </span>
              )}
            </div>
          )}

          {updatedAt && (
            <span className="card-meta-text" style={{
              fontSize: '12px',
              color: 'var(--text-300)',
            }}>
              更新于 {formatTime(updatedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="card-footer" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: '10px',
        marginTop: '10px',
        borderTop: '1px solid var(--border-color-lighter)',
      }}>
        <div>
          {statusText && (
            <span style={{
              fontSize: '12px',
              color: status === 'connected' ? 'var(--positive)' : 'var(--text-300)',
              fontWeight: 500,
            }}>
              {statusText}
            </span>
          )}
        </div>

        <div className="card-actions" style={{ display: 'flex', gap: '4px' }}>
          {onView && (
            <Tooltip title="查看">
              <button
                className="card-action-btn primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onView();
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '5px',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--primary-100)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  width: '29px',
                  height: '29px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--primary-300)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </Tooltip>
          )}

          {onPlay && (
            <Tooltip title={isMCPConnected ? '断开连接' : (status ? '连接' : '运行')}>
              <button
                className="card-action-btn primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(e);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '5px',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--primary-100)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  width: '29px',
                  height: '29px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--primary-300)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
            </Tooltip>
          )}

          {onEdit && (
            <Tooltip title="编辑">
              <button
                className="card-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '5px',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-200)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  width: '29px',
                  height: '29px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
            </Tooltip>
          )}

          {onCopy && (
            <Tooltip title="复制">
              <button
                className="card-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy();
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '5px',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-200)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  width: '29px',
                  height: '29px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </Tooltip>
          )}

          {onDelete && (
            <Popconfirm
              title={
                <div>
                  <div>{deleteConfirmText}</div>
                  {deleteWarning && (
                    <div style={{ color: 'var(--danger-100)', fontSize: 12, marginTop: 4 }}>
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
              <Tooltip title="删除">
                <button
                  className="card-action-btn danger"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: '5px',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--danger-100)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s',
                    width: '29px',
                    height: '29px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      </div>
    </div>
  );
};

export default UnifiedCard;
