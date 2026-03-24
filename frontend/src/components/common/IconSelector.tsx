import React, { useState, useRef, useEffect } from 'react';
import { Tooltip } from 'antd';
import { ICON_LIBRARY } from '../../utils/iconLibrary';

interface IconSelectorProps {
  currentIcon?: string;
  onIconSelect: (icon: string) => void;
  onClose?: () => void;
}

const IconSelector: React.FC<IconSelectorProps> = ({ currentIcon, onIconSelect, onClose }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleIconClick = (icon: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onIconSelect(icon);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <Tooltip title="点击更换图标">
        <div
          onClick={handleToggle}
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-base, 8px)',
            background: 'var(--bg-tertiary, #f1f5f9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            cursor: 'pointer',
            border: '2px solid transparent',
            transition: 'all 0.2s',
            userSelect: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--primary-100, #3F51B5)';
            e.currentTarget.style.background = 'var(--primary-300, #dedeff)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.background = 'var(--bg-tertiary, #f1f5f9)';
          }}
        >
          {currentIcon || '🔄'}
        </div>
      </Tooltip>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 8,
            background: 'var(--bg-100, #FFFFFF)',
            border: '1px solid var(--border-color-light, #e2e8f0)',
            borderRadius: 'var(--radius-lg, 10px)',
            boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1))',
            zIndex: 1000,
            width: 320,
            maxHeight: 400,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-100, #333333)',
              borderBottom: '1px solid var(--border-color-lighter, #f1f5f9)',
              position: 'sticky',
              top: 0,
              background: 'var(--bg-100, #FFFFFF)',
            }}
          >
            选择图标
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 4,
              padding: 12,
            }}
          >
            {ICON_LIBRARY.map((icon, index) => (
              <div
                key={index}
                onClick={(e) => handleIconClick(icon, e)}
                style={{
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm, 4px)',
                  transition: 'all 0.15s',
                  userSelect: 'none',
                  ...(currentIcon === icon
                    ? {
                        background: 'var(--primary-300, #dedeff)',
                        border: '2px solid var(--primary-100, #3F51B5)',
                      }
                    : {}),
                }}
                onMouseEnter={(e) => {
                  if (currentIcon !== icon) {
                    e.currentTarget.style.background = 'var(--bg-tertiary, #f1f5f9)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentIcon !== icon) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {icon}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default IconSelector;
