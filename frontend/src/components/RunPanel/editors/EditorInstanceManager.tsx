import { useRef, useCallback, useEffect } from 'react';

interface ResourceTracker {
  timers: Set<ReturnType<typeof setTimeout>>;
  eventListeners: Array<{ target: EventTarget; event: string; handler: EventListener }>;
  domRefs: Set<HTMLElement>;
  dataRefs: Set<any>;
}

export const useEditorInstanceManager = (instanceId: string) => {
  const resourcesRef = useRef<ResourceTracker>({
    timers: new Set(),
    eventListeners: [],
    domRefs: new Set(),
    dataRefs: new Set(),
  });

  const addTimer = useCallback((timer: ReturnType<typeof setTimeout>) => {
    resourcesRef.current.timers.add(timer);
    return timer;
  }, []);

  const removeTimer = useCallback((timer: ReturnType<typeof setTimeout>) => {
    clearTimeout(timer);
    resourcesRef.current.timers.delete(timer);
  }, []);

  const addEventListener = useCallback((
    target: EventTarget,
    event: string,
    handler: EventListener
  ) => {
    target.addEventListener(event, handler);
    resourcesRef.current.eventListeners.push({ target, event, handler });
  }, []);

  const removeEventListener = useCallback((
    target: EventTarget,
    event: string,
    handler: EventListener
  ) => {
    target.removeEventListener(event, handler);
    const idx = resourcesRef.current.eventListeners.findIndex(
      e => e.target === target && e.event === event && e.handler === handler
    );
    if (idx !== -1) {
      resourcesRef.current.eventListeners.splice(idx, 1);
    }
  }, []);

  const addDomRef = useCallback((element: HTMLElement) => {
    resourcesRef.current.domRefs.add(element);
    return element;
  }, []);

  const addDataRef = useCallback((data: any) => {
    resourcesRef.current.dataRefs.add(data);
    return data;
  }, []);

  const removeDataRef = useCallback((data: any) => {
    resourcesRef.current.dataRefs.delete(data);
  }, []);

  const cleanup = useCallback(() => {
    const resources = resourcesRef.current;
    
    resources.timers.forEach(timer => clearTimeout(timer));
    resources.timers.clear();
    
    resources.eventListeners.forEach(({ target, event, handler }) => {
      target.removeEventListener(event, handler);
    });
    resources.eventListeners.length = 0;
    
    resources.domRefs.forEach(element => {
      element.innerHTML = '';
    });
    resources.domRefs.clear();
    
    resources.dataRefs.forEach(data => {
      if (data instanceof ArrayBuffer) {
        data.slice(0, 0);
      } else if (data && typeof data === 'object') {
        Object.keys(data).forEach(key => {
          try {
            data[key] = null;
          } catch {}
        });
      }
    });
    resources.dataRefs.clear();
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    addTimer,
    removeTimer,
    addEventListener,
    removeEventListener,
    addDomRef,
    addDataRef,
    removeDataRef,
    cleanup,
  };
};
