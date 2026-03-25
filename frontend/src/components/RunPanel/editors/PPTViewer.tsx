import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slideImages, setSlideImages] = useState<string[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (containerRef.current) {
      addDomRef(containerRef.current);
    }
  }, [addDomRef]);

  const loadPPT = useCallback(async (content: string) => {
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
      
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      const slideFiles: string[] = [];
      const slidePattern = /ppt\/slides\/slide(\d+)\.xml/;
      
      const files = Object.keys(zip.files);
      files.forEach((file: string) => {
        const match = file.match(slidePattern);
        if (match) {
          slideFiles.push(match[1]);
        }
      });
      
      slideFiles.sort((a, b) => parseInt(a) - parseInt(b));
      
      if (slideFiles.length === 0) {
        setError('无法解析PPT文件：未找到幻灯片');
      } else {
        setSlideImages(slideFiles.map((_, i) => `Slide ${i + 1}`));
      }
      
      removeDataRef(arrayBuffer);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'PPT文档加载失败');
      setLoading(false);
    }
  }, [addDataRef, removeDataRef]);

  useEffect(() => {
    if (tab.content) {
      loadPPT(tab.content);
    }
  }, [tab.content, loadPPT]);

  const handlePrev = () => {
    setCurrentSlide(prev => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setCurrentSlide(prev => Math.min(slideImages.length - 1, prev + 1));
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(2, prev + 0.1));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(0.5, prev - 0.1));
  };

  useEditorCleanup(instanceId, cleanup);

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
          {currentSlide + 1} / {slideImages.length}
        </span>
        <Button icon={<RightOutlined />} onClick={handleNext} disabled={currentSlide >= slideImages.length - 1} size="small" />
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
          background: '#2d2d2d',
        }} 
      >
        <div style={{
          background: '#fff',
          width: '80%',
          height: '80%',
          maxWidth: 960,
          maxHeight: 540,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${scale})`,
          transition: 'transform 0.2s ease',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          <div style={{ textAlign: 'center', color: '#666' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{slideImages[currentSlide]}</div>
            <div style={{ fontSize: 12, marginTop: 8, color: '#999' }}>
              PPT预览需要部署OnlyOffice服务
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PPTViewer;
