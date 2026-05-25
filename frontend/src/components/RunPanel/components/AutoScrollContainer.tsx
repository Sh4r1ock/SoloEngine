import React, { useRef, useEffect, useCallback } from 'react';

interface AutoScrollContainerProps {
  children: React.ReactNode;
  maxHeight?: string;
  className?: string;
  style?: React.CSSProperties;
  dependency?: any;
}

const AutoScrollContainer: React.FC<AutoScrollContainerProps> = ({
  children,
  maxHeight = '50vh',
  className = 'custom-scrollbar',
  style,
  dependency,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevDependencyRef = useRef(dependency);
  const isAutoScrollEnabledRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        isAutoScrollEnabledRef.current = false;
      } else if (e.deltaY > 0) {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom <= 32) {
          isAutoScrollEnabledRef.current = true;
        }
      }
    };
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom <= 32) {
        isAutoScrollEnabledRef.current = true;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: true });
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (dependency !== prevDependencyRef.current) {
      prevDependencyRef.current = dependency;
      if (isAutoScrollEnabledRef.current) {
        scrollToBottom();
      }
    }
  }, [dependency, scrollToBottom]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: 'flex',
        gap: 0,
        marginTop: 4,
        maxHeight,
        overflow: 'auto',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export default AutoScrollContainer;
