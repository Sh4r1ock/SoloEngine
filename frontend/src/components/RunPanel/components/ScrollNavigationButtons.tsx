import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { MessageListHandle } from './MessageList';

interface ScrollNavigationButtonsProps {
  containerRef: React.RefObject<HTMLDivElement>;
  messageListRef: React.RefObject<MessageListHandle>;
}

const TOP_OFFSET = 16;

const ScrollNavigationButtons: React.FC<ScrollNavigationButtonsProps> = ({ containerRef, messageListRef }) => {
  const [showUpArrow, setShowUpArrow] = useState(false);
  const [showDownArrow, setShowDownArrow] = useState(false);
  const [upHovered, setUpHovered] = useState(false);
  const [downHovered, setDownHovered] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const currentScrollTop = el.scrollTop;
      const isScrollingUp = currentScrollTop < lastScrollTopRef.current;
      lastScrollTopRef.current = currentScrollTop;

      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 64;
      const isAtTop = currentScrollTop <= 10;

      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);

      if (isAtBottom) {
        setShowUpArrow(false);
        setShowDownArrow(false);
      } else if (isAtTop) {
        setShowUpArrow(false);
        setShowDownArrow(true);
      } else if (isScrollingUp) {
        setShowUpArrow(true);
        setShowDownArrow(false);
      } else {
        setShowUpArrow(false);
        setShowDownArrow(true);
      }

      hideTimeoutRef.current = setTimeout(() => {
        setShowUpArrow(false);
        setShowDownArrow(false);
      }, 3000);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [containerRef]);

  const scrollUserMessageToOffset = useCallback((targetElement: HTMLElement) => {
    const el = containerRef.current;
    if (!el) return;
    const containerRect = el.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const relativeTop = targetRect.top - containerRect.top + el.scrollTop;
    el.scrollTo({ top: relativeTop - TOP_OFFSET, behavior: 'smooth' });
  }, [containerRef]);

  const navigateToUserMessage = useCallback((direction: 'prev' | 'next') => {
    const el = containerRef.current;
    if (!el) return;
    messageListRef.current?.disableAutoScroll();
    const userMessages = el.querySelectorAll('[data-message-role="user"]');
    if (userMessages.length === 0) return;

    const containerTop = el.getBoundingClientRect().top;
    let targetElement: HTMLElement | null = null;

    if (direction === 'prev') {
      // 找当前视口上方最近的 user 消息（跳过着陆区内的消息）
      for (let i = userMessages.length - 1; i >= 0; i--) {
        const rect = userMessages[i].getBoundingClientRect();
        if (rect.top < containerTop + TOP_OFFSET - 2) {
          targetElement = userMessages[i] as HTMLElement;
          break;
        }
      }
      if (targetElement) {
        scrollUserMessageToOffset(targetElement);
      } else {
        // 边界：上方没有 user 消息，滚到顶部
        el.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else {
      // 找当前视口下方最近的 user 消息（跳过着陆区内的消息）
      for (let i = 0; i < userMessages.length; i++) {
        const rect = userMessages[i].getBoundingClientRect();
        if (rect.top > containerTop + TOP_OFFSET + 2) {
          targetElement = userMessages[i] as HTMLElement;
          break;
        }
      }
      if (targetElement) {
        scrollUserMessageToOffset(targetElement);
      } else {
        // 边界：下方没有 user 消息，滚到底部
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [containerRef, messageListRef, scrollUserMessageToOffset]);

  return (
    <>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 12,
        display: 'flex', justifyContent: 'center',
        pointerEvents: 'none', zIndex: 50,
        opacity: showUpArrow ? 1 : 0,
        transform: showUpArrow ? 'translateY(0)' : 'translateY(-12px)',
        transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <button
          style={{
            pointerEvents: showUpArrow ? 'auto' : 'none',
            width: 32, height: 32, borderRadius: '50%',
            background: upHovered ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.95)',
            border: '1px solid rgba(0, 0, 0, 0.12)',
            color: upHovered ? 'var(--text-100)' : 'var(--text-300)',
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: upHovered ? 'scale(1.08)' : 'scale(1)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
          onClick={() => navigateToUserMessage('prev')}
          onMouseEnter={() => setUpHovered(true)}
          onMouseLeave={() => setUpHovered(false)}
        >
          <ArrowUpOutlined style={{ fontSize: 14, transition: 'transform 0.2s ease', transform: upHovered ? 'translateY(-1px)' : 'translateY(0)' }} />
        </button>
      </div>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 12,
        display: 'flex', justifyContent: 'center',
        pointerEvents: 'none', zIndex: 50,
        opacity: showDownArrow ? 1 : 0,
        transform: showDownArrow ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <button
          style={{
            pointerEvents: showDownArrow ? 'auto' : 'none',
            width: 32, height: 32, borderRadius: '50%',
            background: downHovered ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.95)',
            border: '1px solid rgba(0, 0, 0, 0.12)',
            color: downHovered ? 'var(--text-100)' : 'var(--text-300)',
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: downHovered ? 'scale(1.08)' : 'scale(1)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
          onClick={() => navigateToUserMessage('next')}
          onMouseEnter={() => setDownHovered(true)}
          onMouseLeave={() => setDownHovered(false)}
        >
          <ArrowDownOutlined style={{ fontSize: 14, transition: 'transform 0.2s ease', transform: downHovered ? 'translateY(1px)' : 'translateY(0)' }} />
        </button>
      </div>
    </>
  );
};

export default ScrollNavigationButtons;
