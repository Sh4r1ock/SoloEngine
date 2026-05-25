import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';

const DEFAULT_BOTTOM_THRESHOLD = 64;

export interface UseAutoScrollOptions {
  containerRef: RefObject<HTMLDivElement> | undefined | null;
  bottomThreshold?: number;
}

export interface UseAutoScrollReturn {
  isAutoScrollEnabled: boolean;
  scrollToBottom: () => void;
  disableAutoScroll: () => void;
  resetAutoScroll: () => void;
  performAutoScroll: () => void;
  performAutoScrollIntoView: (element: HTMLElement | null) => void;
}

export const useAutoScroll = ({
  containerRef,
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
}: UseAutoScrollOptions): UseAutoScrollReturn => {
  const isAutoScrollEnabledRef = useRef(true);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  useEffect(() => {
    if (!containerRef) return;
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        if (isAutoScrollEnabledRef.current) {
          isAutoScrollEnabledRef.current = false;
          setIsAutoScrollEnabled(false);
        }
      } else if (e.deltaY > 0) {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom <= bottomThreshold) {
          if (!isAutoScrollEnabledRef.current) {
            isAutoScrollEnabledRef.current = true;
            setIsAutoScrollEnabled(true);
          }
        }
      }
    };

    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isAtBottom = distanceFromBottom <= bottomThreshold;
      if (isAtBottom && !isAutoScrollEnabledRef.current) {
        isAutoScrollEnabledRef.current = true;
        setIsAutoScrollEnabled(true);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: true });
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef, bottomThreshold]);

  const scrollToBottom = useCallback(() => {
    if (!containerRef) return;
    const el = containerRef.current;
    if (!el) return;
    isAutoScrollEnabledRef.current = true;
    setIsAutoScrollEnabled(true);
    el.scrollTop = el.scrollHeight;
  }, [containerRef]);

  const disableAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = false;
    setIsAutoScrollEnabled(false);
  }, []);

  const resetAutoScroll = useCallback(() => {
    isAutoScrollEnabledRef.current = true;
    setIsAutoScrollEnabled(true);
  }, []);

  const performAutoScroll = useCallback(() => {
    if (!containerRef) return;
    const el = containerRef.current;
    if (!el || !isAutoScrollEnabledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [containerRef]);

  const performAutoScrollIntoView = useCallback((element: HTMLElement | null) => {
    if (!element || !isAutoScrollEnabledRef.current) return;
    element.scrollIntoView({ behavior: 'instant' });
  }, []);

  return {
    isAutoScrollEnabled,
    scrollToBottom,
    disableAutoScroll,
    resetAutoScroll,
    performAutoScroll,
    performAutoScrollIntoView,
  };
};
