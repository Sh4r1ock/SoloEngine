import React from 'react';
import { Background, BackgroundProps, useViewport, BackgroundVariant } from 'reactflow';

interface ScalableBackgroundProps extends Omit<BackgroundProps, 'gap' | 'size'> {
  baseGap?: number;
  baseSize?: number;
  minGap?: number;
  maxGap?: number;
}

const ScalableBackground: React.FC<ScalableBackgroundProps> = ({
  baseGap = 20,
  baseSize = 1,
  minGap = 10,
  maxGap = 50,
  color = 'var(--bg-300)',
  variant = 'dots' as BackgroundVariant,
  ...props
}) => {
  const { zoom } = useViewport();
  const safeZoom = Math.max(0.1, zoom || 1); // 防止zoom为0或undefined
  
  // 计算基于缩放级别的gap和size
  // 使用反比例关系：缩放越大，gap越小
  const calculatedGap = Math.max(minGap, Math.min(maxGap, baseGap / safeZoom));
  const calculatedSize = Math.max(0.5, baseSize / safeZoom);
  
  return (
    <Background
      variant={variant}
      gap={calculatedGap}
      size={calculatedSize}
      color={color}
      {...props}
    />
  );
};

export default ScalableBackground;