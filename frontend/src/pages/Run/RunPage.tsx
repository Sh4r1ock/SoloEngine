/**
 * SoloEngine : 运行页面组件
 *
 * @file RunPage.tsx
 * @description 运行页面 - AgenticFlow执行页面
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本组件提供以下核心功能：
 *     - 显示AgenticFlow运行面板
 *     - 支持指定AgenticFlow ID运行
 *     - 提供全屏运行环境
 *
 * 依赖:
 *     - react: React核心库
 *     - react-router-dom: 路由管理
 *     - ../../components/RunPanel: 运行面板组件
 *
 * 使用示例:
 *     - <Route path="/run/:agenticFlowId" element={<RunPage />} />
 */

import React from 'react';
import { useParams } from 'react-router-dom';
import RunPanel from '../../components/RunPanel';

const RunPage: React.FC = () => {
  const { agenticFlowId } = useParams<{ agenticFlowId?: string }>();

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <RunPanel agenticFlowId={agenticFlowId} />
    </div>
  );
};

export default RunPage;
