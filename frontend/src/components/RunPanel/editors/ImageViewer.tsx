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
