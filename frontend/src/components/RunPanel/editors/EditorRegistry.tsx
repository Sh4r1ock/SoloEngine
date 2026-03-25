import { useRef, useCallback, useEffect } from 'react';
import type { EditorStatus } from '../types';

interface EditorRegistryEntry {
  status: EditorStatus;
  refCount: number;
  instanceIds: Set<string>;
}

interface EditorInstance {
  category: string;
  cleanup: (() => void) | null;
  createdAt: number;
}

class EditorRegistryManager {
  private registry: Map<string, EditorRegistryEntry> = new Map();
  private instances: Map<string, EditorInstance> = new Map();
  private listeners: Set<() => void> = new Set();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  getEntry(category: string): EditorRegistryEntry {
    return this.registry.get(category) || { status: 'unloaded', refCount: 0, instanceIds: new Set() };
  }

  registerInstance(instanceId: string, category: string): void {
    const entry = this.getEntry(category);
    entry.refCount += 1;
    entry.instanceIds.add(instanceId);
    entry.status = 'loaded';
    this.registry.set(category, entry);
    
    this.instances.set(instanceId, {
      category,
      cleanup: null,
      createdAt: Date.now(),
    });
    
    this.notify();
  }

  unregisterInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const entry = this.getEntry(instance.category);
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.instanceIds.delete(instanceId);
    
    if (entry.refCount === 0) {
      entry.status = 'unloaded';
      this.cleanupCategory(instance.category);
    }
    
    this.registry.set(instance.category, entry);
    this.instances.delete(instanceId);
    
    this.notify();
  }

  setInstanceCleanup(instanceId: string, cleanup: () => void): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.cleanup = cleanup;
    }
  }

  runInstanceCleanup(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance?.cleanup) {
      instance.cleanup();
      instance.cleanup = null;
    }
  }

  private cleanupCategory(category: string): void {
    const entry = this.getEntry(category);
    entry.instanceIds.forEach(instanceId => {
      this.runInstanceCleanup(instanceId);
    });
  }

  getStatus(category: string): EditorStatus {
    return this.getEntry(category).status;
  }

  getRefCount(category: string): number {
    return this.getEntry(category).refCount;
  }

  getInstanceCount(category: string): number {
    return this.getEntry(category).instanceIds.size;
  }

  getStats(): { totalInstances: number; categoryStats: Record<string, { refCount: number; status: EditorStatus }> } {
    const categoryStats: Record<string, { refCount: number; status: EditorStatus }> = {};
    this.registry.forEach((entry, category) => {
      categoryStats[category] = { refCount: entry.refCount, status: entry.status };
    });
    return {
      totalInstances: this.instances.size,
      categoryStats,
    };
  }
}

export const editorRegistry = new EditorRegistryManager();

export const useEditorRegistry = (instanceId: string, category: string | null): EditorStatus => {
  const statusRef = useRef<EditorStatus>(category ? editorRegistry.getStatus(category) : 'unloaded');
  
  useEffect(() => {
    if (!category) return;
    
    editorRegistry.registerInstance(instanceId, category);
    statusRef.current = editorRegistry.getStatus(category);
    
    return () => {
      editorRegistry.runInstanceCleanup(instanceId);
      editorRegistry.unregisterInstance(instanceId);
    };
  }, [instanceId, category]);

  useEffect(() => {
    if (!category) return;
    
    const unsubscribe = editorRegistry.subscribe(() => {
      const newStatus = editorRegistry.getStatus(category);
      if (newStatus !== statusRef.current) {
        statusRef.current = newStatus;
      }
    });
    
    return unsubscribe;
  }, [category]);

  return statusRef.current;
};

export const useEditorCleanup = (instanceId: string, cleanup: () => void) => {
  useEffect(() => {
    editorRegistry.setInstanceCleanup(instanceId, cleanup);
  }, [instanceId, cleanup]);
};
