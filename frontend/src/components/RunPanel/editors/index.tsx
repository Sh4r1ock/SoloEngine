import React, { Suspense, useMemo, useEffect } from 'react';
import { Spin } from 'antd';
import type { FileTab, FileCategory } from '../types';
import { getFileTypeInfo, requiresOnlyOffice, getFallbackViewer } from '../utils/fileTypeUtils';
import { useOfficeConfigStore } from '../stores/officeConfigStore';

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

const editorComponents: Record<string, React.LazyExoticComponent<React.FC<any>>> = {
  CodeEditor: React.lazy(() => import('./CodeEditor')),
  MarkdownEditor: React.lazy(() => import('./MarkdownEditor')),
  OnlyOfficeEditor: React.lazy(() => import('./OnlyOfficeEditor')),
  OfficeUnavailableViewer: React.lazy(() => import('./OfficeUnavailableViewer')),
  WordViewer: React.lazy(() => import('./WordViewer')),
  ExcelViewer: React.lazy(() => import('./ExcelViewer')),
  PPTViewer: React.lazy(() => import('./PPTViewer')),
  PDFViewer: React.lazy(() => import('./PDFViewer')),
  ImageViewer: React.lazy(() => import('./ImageViewer')),
  TextViewer: React.lazy(() => import('./TextViewer')),
  UnsupportedViewer: React.lazy(() => import('./UnsupportedViewer')),
};

export const getEditorForFile = (fileName: string, onlyOfficeEnabled: boolean, onlyOfficeStatus: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const typeInfo = getFileTypeInfo(fileName);
  
  if (['doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(ext)) {
    if (onlyOfficeEnabled && onlyOfficeStatus === 'available') {
      return {
        component: editorComponents.OnlyOfficeEditor,
        canEdit: true,
        viewerName: 'OnlyOfficeEditor',
      };
    }
    
    if (requiresOnlyOffice(fileName)) {
      return {
        component: editorComponents.OfficeUnavailableViewer,
        canEdit: false,
        viewerName: 'OfficeUnavailableViewer',
        reason: 'onlyoffice_required',
      };
    }
    
    const fallbackViewer = getFallbackViewer(fileName);
    if (fallbackViewer && editorComponents[fallbackViewer]) {
      return {
        component: editorComponents[fallbackViewer],
        canEdit: false,
        viewerName: fallbackViewer,
        reason: 'fallback',
      };
    }
    
    return {
      component: editorComponents.OfficeUnavailableViewer,
      canEdit: false,
      viewerName: 'OfficeUnavailableViewer',
      reason: 'onlyoffice_required',
    };
  }
  
  const componentName = typeInfo.viewer;
  if (editorComponents[componentName]) {
    return {
      component: editorComponents[componentName],
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

interface EditorLoaderProps {
  tab: FileTab;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tab: FileTab) => void;
}

const EditorLoader: React.FC<EditorLoaderProps> = ({
  tab,
  onContentChange,
  onSave,
}) => {
  const { checkAvailability, config } = useOfficeConfigStore();
  
  useEffect(() => {
    if (config.checkStatus === 'idle') {
      checkAvailability();
    }
  }, [config.checkStatus, checkAvailability]);
  
  const { component: EditorComponent, canEdit, viewerName, reason } = useMemo(() => {
    return getEditorForFile(tab.name, config.enabled, config.checkStatus);
  }, [tab.name, config.enabled, config.checkStatus]);
  
  const instanceId = useMemo(() => `${viewerName}-${tab.id}`, [viewerName, tab.id]);

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

export const editorComponentsByCategory: Record<FileCategory, React.LazyExoticComponent<React.FC<any>>> = {
  code: React.lazy(() => import('./CodeEditor')),
  markdown: React.lazy(() => import('./MarkdownEditor')),
  office: React.lazy(() => import('./OnlyOfficeEditor')),
  pdf: React.lazy(() => import('./PDFViewer')),
  image: React.lazy(() => import('./ImageViewer')),
  text: React.lazy(() => import('./TextViewer')),
  binary: React.lazy(() => import('./UnsupportedViewer')),
  unsupported: React.lazy(() => import('./UnsupportedViewer')),
};

export { editorRegistry, useEditorRegistry, useEditorCleanup } from './EditorRegistry';
export { useEditorInstanceManager } from './EditorInstanceManager';
