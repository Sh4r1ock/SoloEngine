import React, { useState, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button, Spin, Result } from 'antd';
import { LeftOutlined, RightOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
