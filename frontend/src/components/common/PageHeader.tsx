import React, { useState, useRef, useEffect } from 'react';
import { Tooltip, Typography, Divider } from 'antd';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  allTags?: string[];
  selectedTags?: string[];
  onTagToggle?: (tag: string) => void;
  primaryButton?: {
    text: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };
  secondaryButtons?: Array<{
    text: string;
    icon?: React.ReactNode;
    onClick: () => void;
  }>;
  showRefresh?: boolean;
  onRefresh?: () => void;
  refreshLoading?: boolean;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  allTags = [],
  selectedTags = [],
  onTagToggle,
  primaryButton,
  secondaryButtons = [],
  showRefresh = false,
  onRefresh,
  refreshLoading = false,
}) => {
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchFocus = () => {
    if (allTags.length > 0) {
      setShowFilterDropdown(true);
    }
  };

  const handleTagClick = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onTagToggle?.(tag);
  };

  const handleRefreshClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRefresh?.();
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '20px',
      marginBottom: '24px',
      flexWrap: 'wrap',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        {icon && (
          <span style={{
            fontSize: '24px',
            color: 'var(--primary-100)',
            flexShrink: 0,
          }}>
            {icon}
          </span>
        )}
        <div>
          <Title level={3} style={{ margin: 0 }}>
            {title}
          </Title>
          <Text type="secondary" style={{ fontSize: '13px' }}>
            {subtitle}
          </Text>
        </div>
      </div>

      {((searchPlaceholder || primaryButton || secondaryButtons.length > 0 || showRefresh)) && (
        <div className="page-actions" style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
            {searchPlaceholder && (
              <div ref={searchContainerRef} className="search-container" style={{ position: 'relative' }}>
                <span className="search-icon" style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-300)',
                  pointerEvents: 'none',
                  width: '16px',
                  height: '16px',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                  </svg>
                </span>
                <input
                  type="text"
                  className="search-input"
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  style={{
                    borderRadius: 'var(--radius-base)',
                    border: '1px solid var(--bg-300)',
                    backgroundColor: 'var(--bg-100)',
                    padding: '0 12px 0 40px',
                    fontSize: '14px',
                    height: '40px',
                    width: '280px',
                    transition: 'all 0.2s',
                  }}
                  onFocus={(e) => {
                    handleSearchFocus();
                    e.target.style.borderColor = 'var(--primary-100)';
                    e.target.style.outline = 'none';
                    e.target.style.boxShadow = '0 0 0 3px rgba(63, 81, 181, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--bg-300)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                {allTags.length > 0 && (
                  <div className={`filter-dropdown ${showFilterDropdown ? 'show' : ''}`} style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    background: 'var(--bg-100)',
                    border: '1px solid var(--border-color-light)',
                    borderRadius: 'var(--radius-base)',
                    boxShadow: 'var(--shadow-lg)',
                    padding: '12px',
                    zIndex: 100,
                    display: showFilterDropdown ? 'block' : 'none',
                  }}>
                    <div className="filter-section" style={{ marginBottom: 0 }}>
                      <div className="filter-section-title" style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--text-300)',
                        marginBottom: '8px',
                        padding: '0 4px',
                      }}>
                        按标签筛选
                      </div>
                      <div className="filter-tags" style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px',
                      }}>
                        {allTags.map((tag, index) => (
                          <span
                            key={index}
                            className={`filter-tag ${selectedTags.includes(tag) ? 'active' : ''}`}
                            onClick={(e) => handleTagClick(tag, e)}
                            style={{
                              fontSize: '12px',
                              padding: '4px 10px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: selectedTags.includes(tag) ? 'var(--primary-300)' : 'var(--bg-tertiary)',
                              color: selectedTags.includes(tag) ? 'var(--primary-100)' : 'var(--text-200)',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              border: selectedTags.includes(tag) ? '1px solid var(--primary-100)' : '1px solid transparent',
                            }}
                            onMouseEnter={(e) => {
                              if (!selectedTags.includes(tag)) {
                                e.currentTarget.style.backgroundColor = 'var(--primary-300)';
                                e.currentTarget.style.color = 'var(--primary-100)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!selectedTags.includes(tag)) {
                                e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                                e.currentTarget.style.color = 'var(--text-200)';
                              }
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {secondaryButtons.map((btn, index) => (
              <button
                key={index}
                className="btn"
                onClick={btn.onClick}
                style={{
                  borderRadius: 'var(--radius-base)',
                  transition: 'all 0.2s',
                  fontWeight: 500,
                  padding: '9px 16px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  border: '1px solid var(--border-color-light)',
                  background: 'var(--bg-100)',
                  color: 'var(--text-100)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '40px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.background = 'var(--bg-100)';
                }}
              >
                {btn.icon}
                {btn.text}
              </button>
            ))}

            {primaryButton && (
              <button
                className="btn btn-primary btn-lg"
                onClick={primaryButton.onClick}
                style={{
                  borderRadius: 'var(--radius-base)',
                  transition: 'all 0.2s',
                  fontWeight: 500,
                  padding: '9px 20px',
                  fontSize: '15px',
                  cursor: 'pointer',
                  border: '1px solid var(--primary-100)',
                  background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
                  color: 'white',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '40px',
                  boxShadow: '0 4px 12px rgba(63, 81, 181, 0.2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.background = 'linear-gradient(135deg, var(--primary-200), var(--primary-100))';
                  e.currentTarget.style.borderColor = 'var(--primary-200)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(63, 81, 181, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.background = 'linear-gradient(135deg, var(--primary-100), var(--primary-200))';
                  e.currentTarget.style.borderColor = 'var(--primary-100)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(63, 81, 181, 0.2)';
                }}
              >
                {primaryButton.icon}
                {primaryButton.text}
              </button>
            )}

            {showRefresh && (
              <Tooltip title="刷新">
                <button
                  className="btn btn-refresh"
                  onClick={handleRefreshClick}
                  style={{
                    borderRadius: 'var(--radius-base)',
                    transition: 'all 0.2s',
                    fontWeight: 500,
                    padding: '9px 12px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-100)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    height: '40px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                    const svg = e.currentTarget.querySelector('svg');
                    if (svg) {
                      svg.style.transform = 'rotate(180deg)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    const svg = e.currentTarget.querySelector('svg');
                    if (svg) {
                      svg.style.transform = 'rotate(0deg)';
                    }
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.3s' }}>
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </Tooltip>
            )}
          </div>
      )}
    </div>
  );
};

export default PageHeader;
