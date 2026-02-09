import React from 'react';
import { Node } from 'reactflow';

interface SmartGridLinesProps {
  draggingNodeInfo: { id: string; position: { x: number; y: number } } | null;
  nodes: Node[];
  visible: boolean;
  viewX: number;
  viewY: number;
  zoom: number;
}

const SmartGridLines: React.FC<SmartGridLinesProps> = ({ 
  draggingNodeInfo, 
  nodes,
  visible,
  viewX,
  viewY,
  zoom
}) => {
  console.log('SmartGridLines render:', { visible, draggingNodeInfo, nodesCount: nodes?.length, viewX, viewY, zoom });

  if (!visible || !draggingNodeInfo) {
    return null;
  }

  const { id: draggingNodeId, position: { x: draggingX, y: draggingY } } = draggingNodeInfo;

  const nodeWidth = 220;
  const nodeHeight = 116;

  const draggingNode = nodes.find(node => node.id === draggingNodeId);
  if (!draggingNode) return null;

  let targetLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  const otherNodes = nodes.filter(node => node.id !== draggingNodeId);

  for (const node of otherNodes) {
    const { x: targetX, y: targetY } = node.position;
    
    const dx = draggingX - targetX;
    const dy = draggingY - targetY;

    const alignTop = Math.abs(dy) < 30;
    const alignBottom = Math.abs(dy - nodeHeight) < 30;
    const alignLeft = Math.abs(dx) < 30;
    const alignRight = Math.abs(dx - nodeWidth) < 30;

    if (alignTop) {
      targetLines.push({
        x1: targetX,
        y1: targetY,
        x2: targetX + nodeWidth,
        y2: targetY
      });
    }
    if (alignBottom) {
      targetLines.push({
        x1: targetX,
        y1: targetY + nodeHeight,
        x2: targetX + nodeWidth,
        y2: targetY + nodeHeight
      });
    }
    if (alignLeft) {
      targetLines.push({
        x1: targetX,
        y1: targetY,
        x2: targetX,
        y2: targetY + nodeHeight
      });
    }
    if (alignRight) {
      targetLines.push({
        x1: targetX + nodeWidth,
        y1: targetY,
        x2: targetX + nodeWidth,
        y2: targetY + nodeHeight
      });
    }
  }

  const transformLine = (x: number, y: number) => ({
    x: (x - viewX) * zoom,
    y: (y - viewY) * zoom
  });

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
      {targetLines.map((line, index) => {
        const start = transformLine(line.x1, line.y1);
        const end = transformLine(line.x2, line.y2);
        return (
          <line
            key={index}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke="#3F51B5"
            strokeWidth={1 / zoom}
            strokeDasharray="5,5"
            opacity={0.5}
          />
        );
      })}
    </svg>
  );
};

export default SmartGridLines;
