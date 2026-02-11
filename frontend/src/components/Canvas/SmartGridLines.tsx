import React from 'react';
import { Node } from 'reactflow';

interface SmartGridLinesProps {
  draggingNodeInfo: { id: string; position: { x: number; y: number } } | null;
  nodes: Node[];
  visible: boolean;
}

const SmartGridLines: React.FC<SmartGridLinesProps> = ({ 
  draggingNodeInfo,
  nodes,
  visible
}) => {
  if (!visible || !draggingNodeInfo) {
    return null;
  }

  const { id: draggingNodeId, position: { x: draggingX, y: draggingY } } = draggingNodeInfo;

  // 与 AgentNode 的宽度保持一致，高度根据实际视觉效果略作放大
  const nodeWidth = 220;
  const nodeHeight = 120;

  const threshold = 10; // 对齐容差，像素级

  let targetLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  const otherNodes = nodes.filter(node => node.id !== draggingNodeId);

  // 拖拽节点的矩形边界
  const draggingLeft = draggingX;
  const draggingRight = draggingX + nodeWidth;
  const draggingTop = draggingY;
  const draggingBottom = draggingY + nodeHeight;

  for (const node of otherNodes) {
    const { x: targetX, y: targetY } = node.position;
    
    // 目标节点的矩形边界
    const targetLeft = targetX;
    const targetRight = targetX + nodeWidth;
    const targetTop = targetY;
    const targetBottom = targetY + nodeHeight;

    // 粗筛：如果两个矩形相距很远，则跳过详细计算，降低节点多时的开销
    if (
      Math.abs(draggingLeft - targetLeft) > nodeWidth * 2 &&
      Math.abs(draggingTop - targetTop) > nodeHeight * 2
    ) {
      continue;
    }

    // 基于矩形边界的对齐判定（上下左右完全对称）
    const alignTop = Math.abs(draggingTop - targetTop) <= threshold;
    const alignBottom = Math.abs(draggingBottom - targetBottom) <= threshold;
    const alignLeft = Math.abs(draggingLeft - targetLeft) <= threshold;
    const alignRight = Math.abs(draggingRight - targetRight) <= threshold;

    // 使用“较长”线段，在屏幕中表现为整条水平/垂直辅助线
    // 这里用一个足够大的值来模拟从画布最左到最右 / 最上到最下，避免过大的坐标导致渲染异常
    const INF = 10000;

    if (alignTop) {
      targetLines.push({
        x1: -INF,
        y1: targetY,
        x2: INF,
        y2: targetY
      });
    }
    if (alignBottom) {
      targetLines.push({
        x1: -INF,
        y1: targetY + nodeHeight,
        x2: INF,
        y2: targetY + nodeHeight
      });
    }
    if (alignLeft) {
      targetLines.push({
        x1: targetX,
        y1: -INF,
        x2: targetX,
        y2: INF
      });
    }
    if (alignRight) {
      targetLines.push({
        x1: targetX + nodeWidth,
        y1: -INF,
        x2: targetX + nodeWidth,
        y2: INF
      });
    }
  }

  // 若没有任何对齐目标，不渲染 SVG，避免无意义绘制
  if (targetLines.length === 0) {
    return null;
  }

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      {targetLines.map((line, index) => (
        <line
          key={index}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="#FFA726"          // 浅橙色
          strokeWidth={1.5}         // 固定像素宽度，受整体缩放一起缩放
          strokeDasharray="6 4"     // 虚线
          opacity={0.9}
        />
      ))}
    </svg>
  );
};

export default SmartGridLines;
