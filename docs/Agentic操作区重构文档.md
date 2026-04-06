# Agentic操作区重构文档

## 一、目录结构设计

```
RunPanel/
├── index.tsx                         # 主组件入口
├── FileExplorer.tsx                  # 文件资源管理器
├── FileDiffViewer.tsx                # 文件差异对比
├── components/
│   ├── MessageList.tsx               # 消息列表
│   ├── MessageInput.tsx              # 消息输入
│   ├── SessionList.tsx               # 会话列表
│   ├── AgenticPanel.tsx              # Agentic操作区面板（重构简化）
│   ├── CallRecordPanel.tsx           # 工具调用记录
│   └── ChildAgentOutputPanel.tsx     # 子Agent输出
├── editors/                          # 编辑器模块（新增，与components同级）
│   ├── index.tsx                     # 编辑器路由入口（含OnlyOffice检测）
│   ├── EditorLoader.tsx              # 懒加载包装器
│   ├── EditorRegistry.tsx            # 编辑器注册表（管理加载状态和内存）
│   ├── EditorInstanceManager.tsx     # 编辑器实例管理器（内存释放核心）
│   ├── CodeEditor.tsx                # 代码编辑器
│   ├── MarkdownEditor.tsx            # Markdown编辑器
│   ├── OnlyOfficeEditor.tsx          # OnlyOffice编辑器（Office文档核心）
│   ├── OfficeUnavailableViewer.tsx   # OnlyOffice未部署提示
│   ├── ImageViewer.tsx               # 图片预览器
│   ├── PDFViewer.tsx                 # PDF预览器
│   ├── WordViewer.tsx                # Word预览器（降级方案）
│   ├── ExcelViewer.tsx               # Excel预览器（降级方案）
│   ├── PPTViewer.tsx                 # PPT预览器（降级方案）
│   ├── TextViewer.tsx                # 纯文本查看器
│   └── UnsupportedViewer.tsx         # 不支持类型提示
├── hooks/
│   ├── useStreamingData.ts
│   ├── useSessionManager.ts
│   ├── useMessageManager.ts
│   ├── useFileOperations.ts
│   ├── useCallRecords.ts
│   └── useEditorShortcuts.ts         # 新增：快捷键Hook
├── stores/
│   ├── runPanelStore.ts              # 扩展编辑器状态
│   └── officeConfigStore.ts          # 新增：OnlyOffice配置状态
├── types/
│   └── index.ts                      # 扩展文件类型定义
└── utils/
    ├── dataBlockUtils.ts
    ├── timeUtils.ts
    └── fileTypeUtils.ts              # 新增：文件类型判断工具
```

## 二、核心设计理念

### 2.1 Agent 修改文档的需求分析

| 需求 | 说明 | 实现方式 |
|------|------|---------|
| **显示变更记录** | Agent 修改文档后，用户需要看到具体改了什么 | OnlyOffice 修订模式 |
| **引用指定内容** | 用户需要选择文档中的特定内容让 Agent 修改 | OnlyOffice 选择文本 API |
| **实时编辑** | Agent 修改时用户可以同步看到变化 | OnlyOffice 实时协作 |
| **冲突处理** | 多次修改不会互相覆盖 | OnlyOffice 版本控制 |

### 2.2 为什么需要 OnlyOffice

**代码文件**：可以使用文本 diff（+/- 行）显示变更，简单直观。

**Office 文档**：无法像代码一样简单显示 diff，必须使用专业的 Office 编辑器：
- Word 需要「修订模式」显示变更
- Excel 需要单元格级别的变更追踪
- PPT 需要幻灯片级别的变更显示

### 2.3 可选部署策略

```
┌─────────────────────────────────────────────────────────┐
│                    文件类型判断                          │
└─────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
     代码/文本        Office文档        其他文件
          │               │               │
          ▼               ▼               ▼
    CodeMirror      OnlyOffice?      原生预览
    (支持diff)      (可选部署)       (图片/PDF等)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        已部署OnlyOffice        未部署OnlyOffice
              │                       │
              ▼                       ▼
      完整编辑+修订模式         docx-preview预览
      (显示Agent变更)          (提示用户部署)
```

## 三、OnlyOffice vs Collabora 对比

| 维度 | OnlyOffice | Collabora (LibreOffice Online) |
|------|-----------|-------------------------------|
| **界面风格** | 类似 MS Office 365 | 类似 LibreOffice |
| **兼容性** | ✅ 更接近 MS Office | ⚠️ 与 MS Office 有差异 |
| **部署难度** | ✅ Docker 一键部署 | ⚠️ 配置较复杂 |
| **API 集成** | ✅ 完善的 JavaScript API | ⚠️ API 较少 |
| **修订模式** | ✅ 支持 Track Changes | ✅ 支持 |
| **端口** | 80 (可配置) | 9980 |
| **内存需求** | ~2GB | ~4GB |
| **开源协议** | AGPL-3.0 | MPL-2.0 |

**最终选择**：**OnlyOffice**（兼容性更好，部署更简单，API 更完善）

## 四、文件类型定义（types/index.ts）

```typescript
export type FileCategory = 
  | 'code' 
  | 'markdown' 
  | 'office'      // Office文档统一类型
  | 'pdf' 
  | 'image' 
  | 'text' 
  | 'binary' 
  | 'unsupported';

export interface FileTypeInfo {
  category: FileCategory;
  language?: string;
  editable: boolean;
  viewer: string;
  requiresOnlyOffice?: boolean;  // 是否必须 OnlyOffice
  fallbackViewer?: string;        // 降级查看器
}

export const FILE_TYPE_MAP: Record<string, FileTypeInfo> = {
  // 代码文件 - 使用 CodeMirror
  js:   { category: 'code', language: 'javascript', editable: true, viewer: 'CodeEditor' },
  jsx:  { category: 'code', language: 'javascript', editable: true, viewer: 'CodeEditor' },
  ts:   { category: 'code', language: 'typescript', editable: true, viewer: 'CodeEditor' },
  tsx:  { category: 'code', language: 'typescript', editable: true, viewer: 'CodeEditor' },
  py:   { category: 'code', language: 'python', editable: true, viewer: 'CodeEditor' },
  java: { category: 'code', language: 'java', editable: true, viewer: 'CodeEditor' },
  c:    { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
  cpp:  { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
  h:    { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
  hpp:  { category: 'code', language: 'cpp', editable: true, viewer: 'CodeEditor' },
  go:   { category: 'code', language: 'go', editable: true, viewer: 'CodeEditor' },
  rs:   { category: 'code', language: 'rust', editable: true, viewer: 'CodeEditor' },
  rb:   { category: 'code', language: 'ruby', editable: true, viewer: 'CodeEditor' },
  php:  { category: 'code', language: 'php', editable: true, viewer: 'CodeEditor' },
  cs:   { category: 'code', language: 'csharp', editable: true, viewer: 'CodeEditor' },
  swift:{ category: 'code', language: 'swift', editable: true, viewer: 'CodeEditor' },
  kt:   { category: 'code', language: 'kotlin', editable: true, viewer: 'CodeEditor' },
  vue:  { category: 'code', language: 'vue', editable: true, viewer: 'CodeEditor' },
  svelte:{ category: 'code', language: 'html', editable: true, viewer: 'CodeEditor' },
  css:  { category: 'code', language: 'css', editable: true, viewer: 'CodeEditor' },
  scss: { category: 'code', language: 'scss', editable: true, viewer: 'CodeEditor' },
  less: { category: 'code', language: 'less', editable: true, viewer: 'CodeEditor' },
  html: { category: 'code', language: 'html', editable: true, viewer: 'CodeEditor' },
  xml:  { category: 'code', language: 'xml', editable: true, viewer: 'CodeEditor' },
  json: { category: 'code', language: 'json', editable: true, viewer: 'CodeEditor' },
  yaml: { category: 'code', language: 'yaml', editable: true, viewer: 'CodeEditor' },
  yml:  { category: 'code', language: 'yaml', editable: true, viewer: 'CodeEditor' },
  sh:   { category: 'code', language: 'shell', editable: true, viewer: 'CodeEditor' },
  bash: { category: 'code', language: 'shell', editable: true, viewer: 'CodeEditor' },
  ps1:  { category: 'code', language: 'powershell', editable: true, viewer: 'CodeEditor' },
  bat:  { category: 'code', language: 'batch', editable: true, viewer: 'CodeEditor' },
  sql:  { category: 'code', language: 'sql', editable: true, viewer: 'CodeEditor' },
  ini:  { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
  conf: { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
  cfg:  { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
  env:  { category: 'code', language: 'properties', editable: true, viewer: 'CodeEditor' },
  toml: { category: 'code', language: 'toml', editable: true, viewer: 'CodeEditor' },
  
  // Markdown文件 - 使用 react-markdown
  md:   { category: 'markdown', editable: true, viewer: 'MarkdownEditor' },
  markdown: { category: 'markdown', editable: true, viewer: 'MarkdownEditor' },
  
  // Office文档 - 优先 OnlyOffice，降级使用前端预览
  // Word
  docx: { 
    category: 'office', 
    editable: true, 
    viewer: 'OnlyOfficeEditor',
    fallbackViewer: 'WordViewer'
  },
  doc:  { 
    category: 'office', 
    editable: true, 
    viewer: 'OnlyOfficeEditor',
    requiresOnlyOffice: true  // 必须OnlyOffice，无降级
  },
  // Excel
  xlsx: { 
    category: 'office', 
    editable: true, 
    viewer: 'OnlyOfficeEditor',
    fallbackViewer: 'ExcelViewer'
  },
  xls:  { 
    category: 'office', 
    editable: true, 
    viewer: 'OnlyOfficeEditor',
    fallbackViewer: 'ExcelViewer'
  },
  csv:  { 
    category: 'office', 
    editable: true, 
    viewer: 'OnlyOfficeEditor',
    fallbackViewer: 'ExcelViewer'
  },
  // PowerPoint
  pptx: { 
    category: 'office', 
    editable: true, 
    viewer: 'OnlyOfficeEditor',
    fallbackViewer: 'PPTViewer'
  },
  ppt:  { 
    category: 'office', 
    editable: true, 
    viewer: 'OnlyOfficeEditor',
    requiresOnlyOffice: true  // 必须OnlyOffice，无降级
  },
  
  // PDF文档
  pdf:  { category: 'pdf', editable: false, viewer: 'PDFViewer' },
  
  // 图片文件
  png:  { category: 'image', editable: false, viewer: 'ImageViewer' },
  jpg:  { category: 'image', editable: false, viewer: 'ImageViewer' },
  jpeg: { category: 'image', editable: false, viewer: 'ImageViewer' },
  gif:  { category: 'image', editable: false, viewer: 'ImageViewer' },
  bmp:  { category: 'image', editable: false, viewer: 'ImageViewer' },
  ico:  { category: 'image', editable: false, viewer: 'ImageViewer' },
  webp: { category: 'image', editable: false, viewer: 'ImageViewer' },
  svg:  { category: 'image', editable: false, viewer: 'ImageViewer' },
  
  // 纯文本文件
  txt:  { category: 'text', editable: true, viewer: 'TextViewer' },
  log:  { category: 'text', editable: true, viewer: 'TextViewer' },
};
```

## 五、文件类型判断工具（utils/fileTypeUtils.ts）

```typescript
import { FileCategory, FileTypeInfo, FILE_TYPE_MAP } from '../types';

export const getFileExtension = (fileName: string): string => {
  return fileName.split('.').pop()?.toLowerCase() || '';
};

export const getFileTypeInfo = (fileName: string): FileTypeInfo => {
  const ext = getFileExtension(fileName);
  return FILE_TYPE_MAP[ext] || { category: 'unsupported', editable: false, viewer: 'UnsupportedViewer' };
};

export const getFileCategory = (fileName: string): FileCategory => {
  return getFileTypeInfo(fileName).category;
};

export const isEditable = (fileName: string): boolean => {
  return getFileTypeInfo(fileName).editable;
};

export const getLanguage = (fileName: string): string | undefined => {
  return getFileTypeInfo(fileName).language;
};

export const getViewerName = (fileName: string): string => {
  return getFileTypeInfo(fileName).viewer;
};

export const requiresOnlyOffice = (fileName: string): boolean => {
  return getFileTypeInfo(fileName).requiresOnlyOffice ?? false;
};

export const getFallbackViewer = (fileName: string): string | undefined => {
  return getFileTypeInfo(fileName).fallbackViewer;
};
```

## 六、OnlyOffice 配置状态（stores/officeConfigStore.ts）

```typescript
import { create } from 'zustand';

interface OfficeConfig {
  enabled: boolean;
  url: string | null;
  checkStatus: 'idle' | 'checking' | 'available' | 'unavailable';
  lastChecked: number | null;
}

interface OfficeConfigState {
  config: OfficeConfig;
  checkAvailability: () => Promise<boolean>;
  setEnabled: (enabled: boolean) => void;
  setUrl: (url: string) => void;
}

const ONLYOFFICE_CHECK_INTERVAL = 60000; // 1分钟检查一次

export const useOfficeConfigStore = create<OfficeConfigState>((set, get) => ({
  config: {
    enabled: false,
    url: null,
    checkStatus: 'idle',
    lastChecked: null,
  },

  checkAvailability: async () => {
    const { config } = get();
    
    // 如果最近检查过，直接返回缓存结果
    if (config.lastChecked && Date.now() - config.lastChecked < ONLYOFFICE_CHECK_INTERVAL) {
      return config.checkStatus === 'available';
    }

    set(state => ({
      config: { ...state.config, checkStatus: 'checking' }
    }));

    const onlyOfficeUrl = config.url || 'http://localhost:8080';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${onlyOfficeUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const available = response.ok;
      set(state => ({
        config: {
          ...state.config,
          enabled: available,
          checkStatus: available ? 'available' : 'unavailable',
          lastChecked: Date.now(),
        }
      }));

      return available;
    } catch {
      set(state => ({
        config: {
          ...state.config,
          enabled: false,
          checkStatus: 'unavailable',
          lastChecked: Date.now(),
        }
      }));
      return false;
    }
  },

  setEnabled: (enabled) => set(state => ({
    config: { ...state.config, enabled }
  })),

  setUrl: (url) => set(state => ({
    config: { ...state.config, url, checkStatus: 'idle', lastChecked: null }
  })),
}));
```

## 七、编辑器注册表（editors/EditorRegistry.tsx）

```typescript
import { useRef, useCallback, useEffect } from 'react';

type EditorStatus = 'unloaded' | 'loading' | 'loaded';

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
```

## 八、编辑器实例管理器（editors/EditorInstanceManager.tsx）

```typescript
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
    addDomRef,
    addDataRef,
    removeDataRef,
    cleanup,
  };
};
```

## 九、编辑器路由入口（editors/index.tsx）

```typescript
import { lazy } from 'react';
import type { FileCategory } from '../types';
import { useOfficeConfigStore } from '../stores/officeConfigStore';
import { requiresOnlyOffice, getFallbackViewer } from '../utils/fileTypeUtils';

// 编辑器组件映射
const editorComponents = {
  CodeEditor: lazy(() => import('./CodeEditor')),
  MarkdownEditor: lazy(() => import('./MarkdownEditor')),
  OnlyOfficeEditor: lazy(() => import('./OnlyOfficeEditor')),
  OfficeUnavailableViewer: lazy(() => import('./OfficeUnavailableViewer')),
  WordViewer: lazy(() => import('./WordViewer')),
  ExcelViewer: lazy(() => import('./ExcelViewer')),
  PPTViewer: lazy(() => import('./PPTViewer')),
  PDFViewer: lazy(() => import('./PDFViewer')),
  ImageViewer: lazy(() => import('./ImageViewer')),
  TextViewer: lazy(() => import('./TextViewer')),
  UnsupportedViewer: lazy(() => import('./UnsupportedViewer')),
};

// 根据文件名和 OnlyOffice 状态获取编辑器
export const getEditorForFile = (fileName: string) => {
  const { config } = useOfficeConfigStore.getState();
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  // Office 文档特殊处理
  if (['doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(ext)) {
    // OnlyOffice 可用
    if (config.enabled && config.checkStatus === 'available') {
      return {
        component: editorComponents.OnlyOfficeEditor,
        canEdit: true,
        viewerName: 'OnlyOfficeEditor',
      };
    }
    
    // OnlyOffice 不可用，检查是否有降级方案
    if (requiresOnlyOffice(fileName)) {
      // 必须要 OnlyOffice，无降级
      return {
        component: editorComponents.OfficeUnavailableViewer,
        canEdit: false,
        viewerName: 'OfficeUnavailableViewer',
        reason: 'onlyoffice_required',
      };
    }
    
    // 有降级方案
    const fallbackViewer = getFallbackViewer(fileName);
    if (fallbackViewer && editorComponents[fallbackViewer as keyof typeof editorComponents]) {
      return {
        component: editorComponents[fallbackViewer as keyof typeof editorComponents],
        canEdit: false,
        viewerName: fallbackViewer,
        reason: 'fallback',
      };
    }
    
    // 无降级方案
    return {
      component: editorComponents.OfficeUnavailableViewer,
      canEdit: false,
      viewerName: 'OfficeUnavailableViewer',
      reason: 'onlyoffice_required',
    };
  }
  
  // 其他文件类型直接返回对应编辑器
  const { getFileTypeInfo } = require('../utils/fileTypeUtils');
  const typeInfo = getFileTypeInfo(fileName);
  const componentName = typeInfo.viewer;
  
  if (editorComponents[componentName as keyof typeof editorComponents]) {
    return {
      component: editorComponents[componentName as keyof typeof editorComponents],
      canEdit: typeInfo.editable,
      viewerName: componentName,
    };
  }
  
  return {
    component: editorComponents.UnsupportedViewer,
    canEdit: false,
    viewerName: 'UnsupportedViewer',
  };
};

export const editorComponentsByCategory: Record<FileCategory, React.LazyExoticComponent<React.FC<any>>> = {
  code: lazy(() => import('./CodeEditor')),
  markdown: lazy(() => import('./MarkdownEditor')),
  office: lazy(() => import('./OnlyOfficeEditor')),
  pdf: lazy(() => import('./PDFViewer')),
  image: lazy(() => import('./ImageViewer')),
  text: lazy(() => import('./TextViewer')),
  binary: lazy(() => import('./UnsupportedViewer')),
  unsupported: lazy(() => import('./UnsupportedViewer')),
};

export { EditorSkeleton } from './EditorLoader';
export { editorRegistry, useEditorRegistry, useEditorCleanup } from './EditorRegistry';
export { useEditorInstanceManager } from './EditorInstanceManager';
```

## 十、懒加载包装器（editors/EditorLoader.tsx）

```typescript
import React, { Suspense, useMemo, useEffect } from 'react';
import { Spin } from 'antd';
import type { FileTab } from '../types';
import { getEditorForFile } from './index';
import { useEditorRegistry } from './EditorRegistry';
import { useOfficeConfigStore } from '../stores/officeConfigStore';

interface EditorLoaderProps {
  tab: FileTab;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

export const EditorSkeleton = () => (
  <div style={{ 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    height: '100%',
    background: 'var(--bg-100)',
  }}>
    <Spin size="large" tip="加载编辑器..." />
  </div>
);

const EditorLoader: React.FC<EditorLoaderProps> = ({
  tab,
  onContentChange,
  onSave,
}) => {
  // 检查 OnlyOffice 可用性
  const { checkAvailability, config } = useOfficeConfigStore();
  
  useEffect(() => {
    // 首次加载时检查 OnlyOffice
    if (config.checkStatus === 'idle') {
      checkAvailability();
    }
  }, [config.checkStatus, checkAvailability]);
  
  // 获取编辑器组件
  const { component: EditorComponent, canEdit, viewerName, reason } = useMemo(() => {
    return getEditorForFile(tab.name);
  }, [tab.name, config.enabled, config.checkStatus]);
  
  // 生成实例 ID
  const instanceId = useMemo(() => `${viewerName}-${tab.id}`, [viewerName, tab.id]);
  
  // 注册编辑器实例
  useEditorRegistry(instanceId, viewerName);

  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditorComponent
        instanceId={instanceId}
        tab={tab}
        canEdit={canEdit}
        reason={reason}
        onContentChange={onContentChange}
        onSave={onSave}
      />
    </Suspense>
  );
};

export default EditorLoader;
```

## 十一、OnlyOffice 编辑器（editors/OnlyOfficeEditor.tsx）

```typescript
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Spin, Result, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';
import { useOfficeConfigStore } from '../stores/officeConfigStore';

interface OnlyOfficeEditorProps {
  instanceId: string;
  tab: FileTab;
  canEdit: boolean;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

declare global {
  interface Window {
    DocsAPI: any;
  }
}

const OnlyOfficeEditor: React.FC<OnlyOfficeEditorProps> = ({
  instanceId,
  tab,
  canEdit,
  onContentChange,
  onSave,
}) => {
  const { cleanup, addEventListener } = useEditorInstanceManager(instanceId);
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { config } = useOfficeConfigStore();

  const onlyOfficeUrl = config.url || 'http://localhost:8080';

  const initEditor = useCallback(() => {
    if (!window.DocsAPI || !containerRef.current) {
      setError('OnlyOffice API 加载失败');
      setLoading(false);
      return;
    }

    const ext = tab.name.split('.').pop()?.toLowerCase();
    const documentType = ext === 'docx' || ext === 'doc' ? 'word' 
                       : ext === 'xlsx' || ext === 'xls' || ext === 'csv' ? 'cell' 
                       : 'slide';

    try {
      editorRef.current = new window.DocsAPI.DocEditor(containerRef.current, {
        document: {
          fileType: ext,
          key: `${tab.id}-${Date.now()}`, // 唯一 key，用于版本控制
          title: tab.name,
          url: `/api/files/${tab.id}/download`,
          permissions: {
            edit: canEdit,
            download: true,
            print: true,
            review: true,  // 启用审阅模式
          },
        },
        documentType,
        editorConfig: {
          mode: canEdit ? 'edit' : 'view',
          callbackUrl: `/api/files/${tab.id}/callback`,
          user: {
            id: 'agent-user',
            name: 'AI Agent User',
          },
          customization: {
            trackChanges: canEdit,      // 启用修订模式
            showReviewChanges: true,    // 显示修订变更
            reviewDisplay: 'markup',    // 标记模式显示修订
            autosave: true,
            chat: false,
            comments: true,
            compactHeader: false,
            compactToolbar: false,
            help: false,
            hideRightMenu: false,
            hideRulers: false,
            logo: {
              image: '',
              imageEmbedded: '',
              url: '',
            },
            showReviewChanges: true,
            spellcheck: true,
            toolbarNoTabs: false,
            unit: 'cm',
            zoom: 100,
          },
        },
        events: {
          onDocumentStateChange: (event: any) => {
            if (event.data) {
              onContentChange(tab.id, 'modified');
            }
          },
          onError: (event: any) => {
            console.error('OnlyOffice error:', event);
            setError(`编辑器错误: ${event.data?.errorDescription || '未知错误'}`);
          },
          onReady: () => {
            setLoading(false);
          },
        },
      });
    } catch (err: any) {
      console.error('Failed to initialize OnlyOffice:', err);
      setError(`初始化失败: ${err.message}`);
      setLoading(false);
    }
  }, [tab, canEdit, onContentChange]);

  useEffect(() => {
    // 加载 OnlyOffice API 脚本
    const script = document.createElement('script');
    script.src = `${onlyOfficeUrl}/web-apps/apps/api/documents/api.js`;
    script.async = true;
    
    script.onload = () => {
      initEditor();
    };
    
    script.onerror = () => {
      setError('无法加载 OnlyOffice API，请检查服务是否正常运行');
      setLoading(false);
    };
    
    document.head.appendChild(script);

    return () => {
      if (editorRef.current) {
        try {
          editorRef.current.destroyEditor();
        } catch {}
        editorRef.current = null;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [onlyOfficeUrl, initEditor]);

  // Ctrl+S 保存快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave(tab);
      }
    };
    addEventListener(window, 'keydown', handleKeyDown as EventListener);
  }, [tab, onSave, addEventListener]);

  useEditorCleanup(instanceId, cleanup);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载 OnlyOffice 编辑器..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <Result
          status="error"
          title="编辑器加载失败"
          subTitle={error}
          extra={
            <Button 
              type="primary" 
              icon={<ReloadOutlined />}
              onClick={() => {
                setError(null);
                setLoading(true);
                initEditor();
              }}
            >
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', height: '100%' }} 
      id={`onlyoffice-${instanceId}`}
    />
  );
};

export default OnlyOfficeEditor;
```

## 十二、OnlyOffice 未部署提示（editors/OfficeUnavailableViewer.tsx）

```typescript
import React, { useCallback } from 'react';
import { Result, Button, Typography, Collapse } from 'antd';
import { DownloadOutlined, SettingOutlined, BookOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';

const { Paragraph, Text } = Typography;

interface OfficeUnavailableViewerProps {
  instanceId: string;
  tab: FileTab;
  reason: 'onlyoffice_required' | 'fallback_unavailable';
}

const OfficeUnavailableViewer: React.FC<OfficeUnavailableViewerProps> = ({ tab, reason }) => {
  const ext = tab.name.split('.').pop()?.toLowerCase();

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    if (tab.content.startsWith('data:')) {
      link.href = tab.content;
    } else {
      link.href = `data:application/octet-stream;base64,${tab.content}`;
    }
    link.download = tab.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [tab]);

  const deploymentGuide = (
    <Collapse
      items={[
        {
          key: '1',
          label: 'OnlyOffice 部署指南',
          children: (
            <div>
              <Paragraph><Text strong>Docker 部署（推荐）：</Text></Paragraph>
              <pre style={{ 
                background: '#1e1e1e', 
                color: '#d4d4d4', 
                padding: 12, 
                borderRadius: 4,
                overflow: 'auto',
                fontSize: 12,
              }}>
{`docker run -i -t -d -p 8080:80 \\
  --restart=always \\
  -v /app/onlyoffice/DocumentServer/logs:/var/log/onlyoffice \\
  -v /app/onlyoffice/DocumentServer/data:/var/www/onlyoffice/Data \\
  -v /app/onlyoffice/DocumentServer/lib:/var/lib/onlyoffice \\
  -v /app/onlyoffice/DocumentServer/db:/var/lib/postgresql \\
  onlyoffice/documentserver`}
              </pre>
              <Paragraph style={{ marginTop: 12 }}>
                <Text strong>配置文件 (.env)：</Text>
              </Paragraph>
              <pre style={{ 
                background: '#1e1e1e', 
                color: '#d4d4d4', 
                padding: 12, 
                borderRadius: 4,
                fontSize: 12,
              }}>
{`ONLYOFFICE_URL=http://localhost:8080
ONLYOFFICE_ENABLED=true`}
              </pre>
            </div>
          ),
        },
      ]}
    />
  );

  const messages = {
    onlyoffice_required: {
      title: '需要部署 OnlyOffice 服务',
      description: (
        <>
          <Paragraph>
            当前文件类型 <Text strong>.{ext}</Text> 需要 OnlyOffice 服务才能在线编辑和显示变更记录。
          </Paragraph>
          <Paragraph>
            部署 OnlyOffice 后，您可以：
          </Paragraph>
          <ul>
            <li>在线编辑 Word、Excel、PowerPoint 文档</li>
            <li>查看 Agent 修改的变更记录（修订模式）</li>
            <li>选择文档内容让 Agent 进行精确修改</li>
          </ul>
        </>
      ),
    },
    fallback_unavailable: {
      title: '无法预览此文件',
      description: (
        <>
          <Paragraph>
            当前文件类型 <Text strong>.{ext}</Text> 无法在浏览器中预览。
          </Paragraph>
          <Paragraph>
            建议您：
          </Paragraph>
          <ul>
            <li>部署 OnlyOffice 服务以支持在线编辑</li>
            <li>下载文件到本地使用 Office 软件打开</li>
          </ul>
        </>
      ),
    },
  };

  const message = messages[reason] || messages.onlyoffice_required;

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center',
      padding: 24,
      overflow: 'auto',
    }}>
      <Result
        status="warning"
        title={message.title}
        subTitle={message.description}
        extra={[
          <Button type="primary" icon={<SettingOutlined />} key="setup" href="https://helpcenter.onlyoffice.com/installation/docs-community-index.aspx" target="_blank">
            部署 OnlyOffice
          </Button>,
          <Button icon={<DownloadOutlined />} key="download" onClick={handleDownload}>
            下载文件
          </Button>,
        ]}
      />
      <div style={{ width: '100%', maxWidth: 800, marginTop: 24 }}>
        {deploymentGuide}
      </div>
    </div>
  );
};

export default OfficeUnavailableViewer;
```

## 十三、代码编辑器（editors/CodeEditor.tsx）

```typescript
import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { history } from '@codemirror/commands';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { vue } from '@codemirror/lang-vue';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface CodeEditorProps {
  instanceId: string;
  tab: FileTab;
  language?: string;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

const getLanguageExtension = (lang: string) => {
  const langMap: Record<string, any> = {
    javascript: () => languages.javascript(),
    typescript: () => languages.javascript({ jsx: false, typescript: true }),
    python: () => languages.python(),
    java: () => languages.java(),
    cpp: () => languages.cpp(),
    go: () => languages.go(),
    rust: () => languages.rust(),
    html: () => languages.html(),
    css: () => languages.css(),
    scss: () => languages.sass(),
    less: () => languages.less(),
    json: () => languages.json(),
    xml: () => languages.xml(),
    yaml: () => languages.yaml(),
    sql: () => languages.sql(),
    markdown: () => languages.markdown(),
    shell: () => languages.shell(),
    php: () => languages.php(),
    ruby: () => languages.ruby(),
    csharp: () => languages.csharp(),
    swift: () => languages.swift(),
    kotlin: () => languages.kotlin(),
    toml: () => languages.toml(),
    properties: () => languages.properties(),
    vue: () => vue(),
  };
  
  return langMap[lang]?.() || null;
};

const CodeEditor: React.FC<CodeEditorProps> = ({
  instanceId,
  tab,
  language = 'javascript',
  onContentChange,
  onSave,
}) => {
  const { addTimer, removeTimer, addEventListener, cleanup } = useEditorInstanceManager(instanceId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const extensions = useMemo(() => {
    const langExtension = getLanguageExtension(language);
    const exts = [history(), oneDark];
    if (langExtension) {
      exts.unshift(langExtension);
    }
    return exts;
  }, [language]);

  const handleChange = useCallback((value: string) => {
    onContentChange(tab.id, value);
    
    if (saveTimeoutRef.current) {
      removeTimer(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = addTimer(setTimeout(() => {
      if (tab.isModified) {
        onSave(tab);
      }
    }, 500));
  }, [tab.id, tab.isModified, onContentChange, onSave, addTimer, removeTimer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave(tab);
      }
    };
    addEventListener(window, 'keydown', handleKeyDown as EventListener);
  }, [tab, onSave, addEventListener]);

  useEditorCleanup(instanceId, cleanup);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#1e1e1e' }}>
      <CodeMirror
        value={tab.content}
        height="100%"
        extensions={extensions}
        onChange={handleChange}
        theme="dark"
        style={{ 
          height: '100%', 
          fontSize: 13,
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          history: true,
          foldGutter: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
        }}
      />
    </div>
  );
};

export default CodeEditor;
```

## 十四、Markdown编辑器（editors/MarkdownEditor.tsx）

```typescript
import React, { useState, useCallback, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { Button, Tooltip } from 'antd';
import { EditOutlined, EyeOutlined, ColumnWidthOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';
import 'highlight.js/styles/github-dark.css';
import 'github-markdown-css/github-markdown-dark.css';

interface MarkdownEditorProps {
  instanceId: string;
  tab: FileTab;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

type ViewMode = 'edit' | 'split' | 'preview';

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  instanceId,
  tab,
  onContentChange,
  onSave,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const { addTimer, removeTimer, addEventListener, addDomRef, cleanup } = useEditorInstanceManager(instanceId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const handleChange = useCallback((value: string) => {
    onContentChange(tab.id, value);
    
    if (saveTimeoutRef.current) {
      removeTimer(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = addTimer(setTimeout(() => {
      if (tab.isModified) {
        onSave(tab);
      }
    }, 500));
  }, [tab, onContentChange, onSave, addTimer, removeTimer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave(tab);
      }
    };
    addEventListener(window, 'keydown', handleKeyDown as EventListener);
  }, [tab, onSave, addEventListener]);

  useEffect(() => {
    if (previewRef.current) {
      addDomRef(previewRef.current);
    }
  }, [addDomRef]);

  useEditorCleanup(instanceId, cleanup);

  const renderViewModeButton = (mode: ViewMode, icon: React.ReactNode, title: string) => (
    <Tooltip title={title}>
      <Button
        type={viewMode === mode ? 'primary' : 'text'}
        icon={icon}
        onClick={() => setViewMode(mode)}
        size="small"
      />
    </Tooltip>
  );

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', background: 'var(--bg-100)' }}>
      <div style={{ 
        display: 'flex', 
        gap: 4, 
        padding: '8px 12px',
        borderBottom: '1px solid var(--bg-300)',
        background: 'var(--bg-200)',
      }}>
        {renderViewModeButton('edit', <EditOutlined />, '编辑模式')}
        {renderViewModeButton('split', <ColumnWidthOutlined />, '分栏模式')}
        {renderViewModeButton('preview', <EyeOutlined />, '预览模式')}
        <div style={{ flex: 1 }} />
        {tab.isModified && <span style={{ color: 'var(--warning)', fontSize: 12 }}>未保存</span>}
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div style={{ 
            flex: viewMode === 'split' ? 1 : 2, 
            overflow: 'auto',
            borderRight: viewMode === 'split' ? '1px solid var(--bg-300)' : 'none',
          }}>
            <CodeMirror
              value={tab.content}
              height="100%"
              onChange={handleChange}
              theme="dark"
              style={{ fontSize: 13 }}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightSpecialChars: true,
                history: true,
                foldGutter: true,
                drawSelection: true,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                syntaxHighlighting: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                rectangularSelection: true,
                crosshairCursor: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
              }}
            />
          </div>
        )}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div 
            ref={previewRef}
            style={{ 
              flex: viewMode === 'split' ? 1 : 2, 
              overflow: 'auto',
              padding: 16,
              background: 'var(--bg-100)',
            }}
          >
            <div className="markdown-body" style={{ background: 'transparent' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight, rehypeRaw]}
                components={{
                  code({ className, children, ...props }) {
                    const isCodeBlock = className?.includes('language-');
                    if (isCodeBlock) {
                      return <code className={className} {...props}>{children}</code>;
                    }
                    return <code className="inline-code" {...props}>{children}</code>;
                  },
                }}
              >
                {tab.content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownEditor;
```

## 十五、Word预览器（editors/WordViewer.tsx）- 降级方案

```typescript
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { Spin, Result, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface WordViewerProps {
  instanceId: string;
  tab: FileTab;
}

const WordViewer: React.FC<WordViewerProps> = ({ instanceId, tab }) => {
  const { addDomRef, addDataRef, removeDataRef, cleanup } = useEditorInstanceManager(instanceId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      addDomRef(containerRef.current);
    }
  }, [addDomRef]);

  const loadDocument = useCallback(async (content: string) => {
    if (!containerRef.current) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      let arrayBuffer: ArrayBuffer;
      
      if (content.startsWith('data:')) {
        const base64 = content.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else {
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      }
      
      addDataRef(arrayBuffer);
      
      await renderAsync(arrayBuffer, containerRef.current!, undefined, {
        className: 'docx-container',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      });
      
      removeDataRef(arrayBuffer);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || '文档加载失败');
      setLoading(false);
    }
  }, [addDataRef, removeDataRef]);

  useEffect(() => {
    loadDocument(tab.content);
  }, [tab.content, loadDocument]);

  useEditorCleanup(instanceId, cleanup);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载Word文档..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <Result
          status="error"
          title="文档加载失败"
          subTitle={error}
          extra={
            <Button 
              type="primary" 
              icon={<ReloadOutlined />}
              onClick={() => loadDocument(tab.content)}
            >
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      style={{ 
        height: '100%', 
        overflow: 'auto',
        background: '#f0f0f0',
      }} 
    />
  );
};

export default WordViewer;
```

## 十六、Excel预览器（editors/ExcelViewer.tsx）- 降级方案

```typescript
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Table, Tabs, Spin, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface ExcelViewerProps {
  instanceId: string;
  tab: FileTab;
}

const ExcelViewer: React.FC<ExcelViewerProps> = ({ instanceId, tab }) => {
  const { addDataRef, removeDataRef, cleanup } = useEditorInstanceManager(instanceId);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tab.content) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const loadWorkbook = async () => {
      try {
        let arrayBuffer: ArrayBuffer;
        
        if (tab.content.startsWith('data:')) {
          const base64 = tab.content.split(',')[1];
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        } else {
          const binaryString = atob(tab.content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        }
        
        addDataRef(arrayBuffer);
        
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        
        removeDataRef(arrayBuffer);
        
        setWorkbook(wb);
        setActiveSheet(wb.SheetNames[0]);
        setLoading(false);
      } catch (err: any) {
        setError(err.message || 'Excel解析失败');
        setLoading(false);
      }
    };
    
    loadWorkbook();
  }, [tab.content, addDataRef, removeDataRef]);

  const { columns, data } = useMemo(() => {
    if (!workbook || !activeSheet) return { columns: [], data: [] };
    
    const sheet = workbook.Sheets[activeSheet];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
    
    if (jsonData.length === 0) return { columns: [], data: [] };
    
    const headers = jsonData[0];
    const cols: ColumnsType<any> = headers.map((h: any, i: number) => ({
      title: h?.toString() || `列${i + 1}`,
      dataIndex: `col_${i}`,
      key: `col_${i}`,
      ellipsis: true,
      width: 150,
    }));
    
    const rows = jsonData.slice(1).map((row, i) => {
      const rowData: Record<string, any> = { key: i };
      row.forEach((cell, j) => {
        rowData[`col_${j}`] = cell?.toString() || '';
      });
      return rowData;
    });
    
    return { columns: cols, data: rows };
  }, [workbook, activeSheet]);

  useEditorCleanup(instanceId, useCallback(() => {
    setWorkbook(null);
    setActiveSheet('');
    cleanup();
  }, [cleanup]));

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载Excel文档..." />
      </div>
    );
  }

  if (error || !workbook) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description={error || '无法解析Excel文档'} />
      </div>
    );
  }

  const sheetTabs = workbook.SheetNames.map(name => ({
    key: name,
    label: name,
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-100)' }}>
      <Tabs
        activeKey={activeSheet}
        onChange={setActiveSheet}
        items={sheetTabs}
        style={{ padding: '0 12px', marginBottom: 0 }}
        size="small"
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px' }}>
        <Table 
          columns={columns} 
          dataSource={data} 
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          size="small"
          scroll={{ x: 'max-content', y: 'calc(100vh - 250px)' }}
          bordered
        />
      </div>
    </div>
  );
};

export default ExcelViewer;
```

## 十七、PPT预览器（editors/PPTViewer.tsx）- 降级方案

```typescript
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init } from 'pptx-preview';
import { Button, Spin, Result } from 'antd';
import { LeftOutlined, RightOutlined, ZoomInOutlined, ZoomOutOutlined, ReloadOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface PPTViewerProps {
  instanceId: string;
  tab: FileTab;
}

const PPTViewer: React.FC<PPTViewerProps> = ({ instanceId, tab }) => {
  const { addDomRef, addDataRef, removeDataRef, cleanup } = useEditorInstanceManager(instanceId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const pptxPreviewerRef = useRef<any>(null);

  useEffect(() => {
    if (containerRef.current) {
      addDomRef(containerRef.current);
    }
  }, [addDomRef]);

  const loadPPT = useCallback(async (content: string) => {
    if (!containerRef.current) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      let arrayBuffer: ArrayBuffer;
      
      if (content.startsWith('data:')) {
        const base64 = content.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else {
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      }
      
      addDataRef(arrayBuffer);
      
      const width = containerRef.current.clientWidth || 800;
      const height = (containerRef.current.clientHeight || 600) - 50;
      
      pptxPreviewerRef.current = init(containerRef.current, {
        width: Math.max(width, 400),
        height: Math.max(height, 300),
      });
      
      const result = await pptxPreviewerRef.current.preview(arrayBuffer);
      
      removeDataRef(arrayBuffer);
      
      setTotalSlides(result?.slideCount || 1);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'PPT文档加载失败');
      setLoading(false);
    }
  }, [addDataRef, removeDataRef]);

  useEffect(() => {
    loadPPT(tab.content);
  }, [tab.content, loadPPT]);

  const handlePrev = () => {
    if (currentSlide > 0 && pptxPreviewerRef.current) {
      const newSlide = currentSlide - 1;
      setCurrentSlide(newSlide);
      pptxPreviewerRef.current.gotoSlide?.(newSlide);
    }
  };

  const handleNext = () => {
    if (currentSlide < totalSlides - 1 && pptxPreviewerRef.current) {
      const newSlide = currentSlide + 1;
      setCurrentSlide(newSlide);
      pptxPreviewerRef.current.gotoSlide?.(newSlide);
    }
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(2, prev + 0.1));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(0.5, prev - 0.1));
  };

  useEditorCleanup(instanceId, useCallback(() => {
    pptxPreviewerRef.current = null;
    cleanup();
  }, [cleanup]));

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载PPT文档..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <Result
          status="error"
          title="PPT加载失败"
          subTitle={error}
          extra={
            <Button 
              type="primary" 
              icon={<ReloadOutlined />}
              onClick={() => loadPPT(tab.content)}
            >
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '8px 12px',
        borderBottom: '1px solid var(--bg-300)',
        background: 'var(--bg-200)',
      }}>
        <Button icon={<LeftOutlined />} onClick={handlePrev} disabled={currentSlide === 0} size="small" />
        <span style={{ color: 'var(--text-200)', minWidth: 60, textAlign: 'center' }}>
          {currentSlide + 1} / {totalSlides}
        </span>
        <Button icon={<RightOutlined />} onClick={handleNext} disabled={currentSlide >= totalSlides - 1} size="small" />
        <div style={{ width: 1, height: 16, background: 'var(--bg-300)', margin: '0 8px' }} />
        <Button icon={<ZoomOutOutlined />} onClick={handleZoomOut} size="small" />
        <span style={{ color: 'var(--text-200)', minWidth: 40 }}>{Math.round(scale * 100)}%</span>
        <Button icon={<ZoomInOutlined />} onClick={handleZoomIn} size="small" />
      </div>
      <div 
        ref={containerRef} 
        style={{ 
          flex: 1, 
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }} 
      />
    </div>
  );
};

export default PPTViewer;
```

## 十八、PDF预览器（editors/PDFViewer.tsx）

```typescript
import React, { useState, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button, Spin, Result } from 'antd';
import { LeftOutlined, RightOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

interface PDFViewerProps {
  instanceId: string;
  tab: FileTab;
}

const PDFViewer: React.FC<PDFViewerProps> = ({ instanceId, tab }) => {
  const { cleanup } = useEditorInstanceManager(instanceId);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message);
    setLoading(false);
  }, []);

  const handlePrev = () => {
    setPageNumber(p => Math.max(1, p - 1));
  };

  const handleNext = () => {
    setPageNumber(p => Math.min(numPages, p + 1));
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(2, prev + 0.1));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(0.5, prev - 0.1));
  };

  const fileUrl = tab.content.startsWith('data:') 
    ? tab.content 
    : `data:application/pdf;base64,${tab.content}`;

  useEditorCleanup(instanceId, useCallback(() => {
    setNumPages(0);
    setPageNumber(1);
    cleanup();
  }, [cleanup]));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '8px 12px',
        borderBottom: '1px solid var(--bg-300)',
        background: 'var(--bg-200)',
      }}>
        <Button icon={<LeftOutlined />} onClick={handlePrev} disabled={pageNumber <= 1} size="small" />
        <span style={{ color: 'var(--text-200)', minWidth: 60, textAlign: 'center' }}>
          {pageNumber} / {numPages}
        </span>
        <Button icon={<RightOutlined />} onClick={handleNext} disabled={pageNumber >= numPages} size="small" />
        <div style={{ width: 1, height: 16, background: 'var(--bg-300)', margin: '0 8px' }} />
        <Button icon={<ZoomOutOutlined />} onClick={handleZoomOut} size="small" />
        <span style={{ color: 'var(--text-200)', minWidth: 40 }}>{Math.round(scale * 100)}%</span>
        <Button icon={<ZoomInOutlined />} onClick={handleZoomIn} size="small" />
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 16 }}>
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={<Spin size="large" tip="加载PDF文档..." />}
          error={
            <Result
              status="error"
              title="PDF加载失败"
              subTitle={error}
            />
          }
        >
          <Page 
            pageNumber={pageNumber} 
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        </Document>
      </div>
    </div>
  );
};

export default PDFViewer;
```

## 十九、图片预览器（editors/ImageViewer.tsx）

```typescript
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined, RotateLeftOutlined, RotateRightOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface ImageViewerProps {
  instanceId: string;
  tab: FileTab;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ instanceId, tab }) => {
  const { addDomRef, cleanup } = useEditorInstanceManager(instanceId);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imageRef.current) {
      addDomRef(imageRef.current);
    }
  }, [addDomRef]);

  const ext = tab.name.split('.').pop()?.toLowerCase() || 'png';
  const mimeType: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  };
  
  const imageUrl = tab.content.startsWith('data:') 
    ? tab.content 
    : `data:${mimeType[ext] || 'image/png'};base64,${tab.content}`;

  const handleZoomIn = () => setScale(prev => Math.min(3, prev + 0.2));
  const handleZoomOut = () => setScale(prev => Math.max(0.2, prev - 0.2));
  const handleRotateLeft = () => setRotation(prev => prev - 90);
  const handleRotateRight = () => setRotation(prev => prev + 90);

  useEditorCleanup(instanceId, cleanup);

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: '#1a1a1a',
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '8px 12px',
        borderBottom: '1px solid var(--bg-300)',
        background: 'var(--bg-200)',
      }}>
        <Button icon={<ZoomOutOutlined />} onClick={handleZoomOut} size="small" />
        <span style={{ color: 'var(--text-200)', minWidth: 40 }}>{Math.round(scale * 100)}%</span>
        <Button icon={<ZoomInOutlined />} onClick={handleZoomIn} size="small" />
        <div style={{ width: 1, height: 16, background: 'var(--bg-300)', margin: '0 8px' }} />
        <Button icon={<RotateLeftOutlined />} onClick={handleRotateLeft} size="small" />
        <Button icon={<RotateRightOutlined />} onClick={handleRotateRight} size="small" />
      </div>
      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: 16,
      }}>
        <img 
          ref={imageRef}
          src={imageUrl} 
          alt={tab.name}
          style={{ 
            maxWidth: '100%', 
            maxHeight: '100%', 
            objectFit: 'contain',
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transition: 'transform 0.2s ease',
          }} 
        />
      </div>
    </div>
  );
};

export default ImageViewer;
```

## 二十、纯文本查看器（editors/TextViewer.tsx）

```typescript
import React, { useCallback, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface TextViewerProps {
  instanceId: string;
  tab: FileTab;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

const TextViewer: React.FC<TextViewerProps> = ({
  instanceId,
  tab,
  onContentChange,
  onSave,
}) => {
  const { addTimer, removeTimer, addEventListener, cleanup } = useEditorInstanceManager(instanceId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((value: string) => {
    onContentChange(tab.id, value);
    
    if (saveTimeoutRef.current) {
      removeTimer(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = addTimer(setTimeout(() => {
      if (tab.isModified) {
        onSave(tab);
      }
    }, 500));
  }, [tab, onContentChange, onSave, addTimer, removeTimer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave(tab);
      }
    };
    addEventListener(window, 'keydown', handleKeyDown as EventListener);
  }, [tab, onSave, addEventListener]);

  useEditorCleanup(instanceId, cleanup);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#1e1e1e' }}>
      <CodeMirror
        value={tab.content}
        height="100%"
        onChange={handleChange}
        theme="dark"
        style={{ fontSize: 13 }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          history: true,
          drawSelection: true,
        }}
      />
    </div>
  );
};

export default TextViewer;
```

## 二十一、不支持类型提示（editors/UnsupportedViewer.tsx）

```typescript
import React, { useCallback } from 'react';
import { Typography, Button } from 'antd';
import { FileUnknownOutlined, DownloadOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';

const { Text } = Typography;

interface UnsupportedViewerProps {
  instanceId: string;
  tab: FileTab;
}

const UnsupportedViewer: React.FC<UnsupportedViewerProps> = ({ tab }) => {
  const ext = tab.name.split('.').pop()?.toLowerCase() || 'unknown';

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    if (tab.content.startsWith('data:')) {
      link.href = tab.content;
    } else {
      link.href = `data:application/octet-stream;base64,${tab.content}`;
    }
    link.download = tab.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [tab]);

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'var(--bg-100)',
      padding: 32,
    }}>
      <FileUnknownOutlined style={{ fontSize: 64, color: 'var(--text-300)', marginBottom: 24 }} />
      <Text style={{ fontSize: 16, color: 'var(--text-200)', marginBottom: 8 }}>
        不支持的文件类型
      </Text>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
        文件名: {tab.name}
      </Text>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
        扩展名: .{ext}
      </Text>
      <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', maxWidth: 400, marginBottom: 24 }}>
        当前版本暂不支持预览此类型文件。您可以下载后使用本地应用程序打开。
      </Text>
      <Button 
        type="primary" 
        icon={<DownloadOutlined />}
        onClick={handleDownload}
      >
        下载文件
      </Button>
    </div>
  );
};

export default UnsupportedViewer;
```

## 二十二、快捷键Hook（hooks/useEditorShortcuts.ts）

```typescript
import { useEffect, useCallback } from 'react';
import type { FileTab } from '../types';

interface UseEditorShortcutsProps {
  activeTab: FileTab | null;
  onSave: (tab: FileTab) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const useEditorShortcuts = ({
  activeTab,
  onSave,
  onUndo,
  onRedo,
}: UseEditorShortcutsProps) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!activeTab) return;

    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key === 's') {
      e.preventDefault();
      onSave(activeTab);
      return;
    }

    if (isMod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      onUndo?.();
      return;
    }

    if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      onRedo?.();
      return;
    }
  }, [activeTab, onSave, onUndo, onRedo]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};
```

## 二十三、后端 OnlyOffice 回调 API

```python
# api/onlyoffice.py
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import json
import base64
from pathlib import Path

router = APIRouter()

@router.post("/api/files/{file_id}/callback")
async def onlyoffice_callback(file_id: str, request: Request):
    """
    OnlyOffice 文档保存回调
    
    OnlyOffice 在文档保存时会调用此接口
    """
    body = await request.json()
    
    status = body.get("status", 0)
    key = body.get("key", "")
    
    # status 说明:
    # 0 - 找不到具有key的文档
    # 1 - 正在编辑文档
    # 2 - 文档已准备好保存
    # 3 - 文档保存错误
    # 4 - 文档关闭，没有更改
    # 6 - 文档正在编辑，但当前文档状态已保存
    # 7 - 强制保存文档时发生错误
    
    if status == 2:
        # 文档已准备好保存
        download_url = body.get("url")
        if download_url:
            # 下载文档内容
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.get(download_url)
                if response.status_code == 200:
                    content = base64.b64encode(response.content).decode('utf-8')
                    
                    # 更新数据库中的文件内容
                    # await update_file_content(file_id, content)
                    
                    return JSONResponse({"error": 0})
        
    elif status == 1:
        # 文档正在编辑
        pass
    
    elif status == 4:
        # 文档关闭，没有更改
        pass
    
    return JSONResponse({"error": 0})

@router.get("/api/files/{file_id}/download")
async def download_file(file_id: str):
    """
    文件下载接口，供 OnlyOffice 加载文档
    """
    # 从数据库获取文件内容
    # file = await get_file(file_id)
    
    # 示例：返回测试文件
    from fastapi.responses import Response
    
    # file_content = file.content  # base64 编码的内容
    # file_name = file.name
    
    # return Response(
    #     content=base64.b64decode(file_content),
    #     media_type="application/octet-stream",
    #     headers={"Content-Disposition": f'attachment; filename="{file_name}"'}
    # )
    
    pass
```

## 二十四、依赖包安装

```bash
npm install @uiw/react-codemirror@latest @codemirror/commands @codemirror/language @codemirror/language-data @codemirror/theme-one-dark @codemirror/lang-vue xlsx pptx-preview react-pdf@latest
```

**依赖版本说明**：

| 包名 | 版本 | 用途 |
|------|------|------|
| @uiw/react-codemirror | latest | CodeMirror 6 React 封装 |
| @codemirror/commands | latest | 编辑器命令（撤销、重做等） |
| @codemirror/language | latest | 语言支持基础包 |
| @codemirror/language-data | latest | 多语言语法支持 |
| @codemirror/theme-one-dark | latest | One Dark 主题 |
| @codemirror/lang-vue | latest | Vue 文件语法支持 |
| xlsx | latest | Excel 文件解析（降级方案） |
| pptx-preview | latest | PPT 文件预览（降级方案） |
| react-pdf | latest | PDF 文件预览 |
| docx-preview | latest | Word 文件预览（降级方案） |

**已安装依赖（无需额外安装）**：
- `react-markdown` v10 - Markdown 渲染
- `remark-gfm` - GitHub Flavored Markdown
- `rehype-highlight` - 代码高亮
- `rehype-raw` - 原始 HTML 支持
- `highlight.js` - 代码高亮样式
- `github-markdown-css` - Markdown 样式

**OnlyOffice 部署**：
```bash
# Docker 部署
docker run -i -t -d -p 8080:80 \
  --restart=always \
  -v /app/onlyoffice/DocumentServer/logs:/var/log/onlyoffice \
  -v /app/onlyoffice/DocumentServer/data:/var/www/onlyoffice/Data \
  -v /app/onlyoffice/DocumentServer/lib:/var/lib/onlyoffice \
  -v /app/onlyoffice/DocumentServer/db:/var/lib/postgresql \
  onlyoffice/documentserver
```

## 二十五、Vite配置优化

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('@codemirror') || id.includes('@uiw/react-codemirror')) {
            return 'codemirror';
          }
          if (id.includes('docx-preview') || id.includes('xlsx') || id.includes('pptx-preview')) {
            return 'office-preview';
          }
          if (id.includes('react-pdf') || id.includes('pdfjs-dist')) {
            return 'pdf';
          }
          if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype')) {
            return 'markdown';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: [
      '@uiw/react-codemirror',
      'react-markdown',
      'remark-gfm',
    ],
  },
});
```

## 二十六、文件格式支持矩阵

| 格式 | 扩展名 | OnlyOffice 已部署 | OnlyOffice 未部署 |
|------|--------|------------------|------------------|
| Word | .docx | ✅ 完整编辑+修订模式 | ⚠️ 仅预览（docx-preview） |
| Word | .doc | ✅ 完整编辑+修订模式 | ❌ 提示部署 OnlyOffice |
| Excel | .xlsx | ✅ 完整编辑 | ⚠️ 仅预览（SheetJS） |
| Excel | .xls | ✅ 完整编辑 | ⚠️ 仅预览（SheetJS） |
| Excel | .csv | ✅ 完整编辑 | ⚠️ 仅预览（SheetJS） |
| PPT | .pptx | ✅ 完整编辑 | ⚠️ 仅预览（pptx-preview） |
| PPT | .ppt | ✅ 完整编辑 | ❌ 提示部署 OnlyOffice |
| PDF | .pdf | ✅ 查看 | ✅ 查看（react-pdf） |
| 图片 | .png/.jpg等 | ✅ 查看 | ✅ 查看（原生） |
| 代码 | .js/.ts等 | ✅ CodeMirror编辑 | ✅ CodeMirror编辑 |
| Markdown | .md | ✅ 编辑 | ✅ 编辑（react-markdown） |

## 二十七、内存管理机制说明

### 27.1 技术限制

**JavaScript 模块缓存限制**：
- React.lazy 加载的模块代码会被浏览器缓存
- JavaScript 无法直接清除浏览器模块缓存
- 模块代码在首次加载后保留在浏览器内存中

### 27.2 可释放资源

通过 EditorInstanceManager 管理以下资源：

| 资源类型 | 释放方式 |
|---------|---------|
| 定时器 | clearTimeout() |
| 事件监听器 | removeEventListener() |
| DOM 引用 | innerHTML = '' |
| ArrayBuffer | slice(0, 0) |
| 解析数据 | 对象属性置 null |

### 27.3 引用计数机制

1. 每个编辑器实例注册时，对应类型的引用计数 +1
2. 实例卸载时，引用计数 -1
3. 当某类型引用计数归零时，执行该类型所有实例的清理函数
4. 清理函数释放组件内部状态和数据引用

### 27.4 内存释放流程

```
文件关闭
    ↓
EditorLoader 卸载
    ↓
useEditorRegistry cleanup 触发
    ↓
runInstanceCleanup() 执行
    ↓
EditorInstanceManager.cleanup()
    ↓
释放定时器、事件监听器、DOM引用、数据引用
    ↓
引用计数 -1
    ↓
如果计数归零 → 标记该类型为 unloaded
```

## 二十八、执行顺序

1. 创建 `utils/fileTypeUtils.ts` 文件类型判断工具
2. 扩展 `types/index.ts` 添加文件类型定义
3. 创建 `stores/officeConfigStore.ts` OnlyOffice 配置状态
4. 创建 `editors/` 目录
5. 创建 `editors/EditorRegistry.tsx` 编辑器注册表
6. 创建 `editors/EditorInstanceManager.tsx` 实例管理器
7. 创建 `editors/index.tsx` 编辑器路由入口（含 OnlyOffice 检测）
8. 创建 `editors/EditorLoader.tsx` 懒加载包装器
9. 创建 `editors/CodeEditor.tsx` 代码编辑器
10. 创建 `editors/MarkdownEditor.tsx` Markdown编辑器
11. 创建 `editors/OnlyOfficeEditor.tsx` OnlyOffice 编辑器
12. 创建 `editors/OfficeUnavailableViewer.tsx` 未部署提示组件
13. 创建 `editors/WordViewer.tsx` Word预览器（降级方案）
14. 创建 `editors/ExcelViewer.tsx` Excel预览器（降级方案）
15. 创建 `editors/PPTViewer.tsx` PPT预览器（降级方案）
16. 创建 `editors/PDFViewer.tsx` PDF预览器
17. 创建 `editors/ImageViewer.tsx` 图片预览器
18. 创建 `editors/TextViewer.tsx` 纯文本查看器
19. 创建 `editors/UnsupportedViewer.tsx` 不支持类型提示
20. 创建 `hooks/useEditorShortcuts.ts` 快捷键Hook
21. 扩展 `stores/runPanelStore.ts` 编辑器状态
22. 创建后端 OnlyOffice 回调 API
23. 重构 `components/AgenticPanel.tsx` 集成新编辑器
24. 安装依赖包
25. 配置Vite代码分割
26. 测试验证
