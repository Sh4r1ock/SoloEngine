/**
 * @file components/ChildAgentOutputPanel.tsx
 * @description 子模型输出面板组件
 */

import React, { useState } from 'react';
import { Typography, Tag, Space, Empty, Collapse, Button, Tooltip, List } from 'antd';
import {
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { ChildAgentOutput } from '../types';

const { Text, Paragraph } = Typography;

interface ChildAgentOutputPanelProps {
  outputs: ChildAgentOutput[];
  maxHeight?: number;
}

const ChildAgentOutputPanel: React.FC<ChildAgentOutputPanelProps> = ({
  outputs,
  maxHeight = 400,
}) => {
  const sortedOutputs = [...outputs].sort((a, b) => {
    const timeA = a.startTime || 0;
    const timeB = b.startTime || 0;
    return timeB - timeA;
  });

  const formatDuration = (duration?: number) => {
    if (!duration) return '';
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`;
    return `${(duration / 60000).toFixed(2)}m`;
  };

  const formatJson = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'error':
        return 'error';
      case 'running':
        return 'processing';
      default:
        return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'error':
        return '失败';
      case 'running':
        return '执行中';
      default:
        return status;
    }
  };

  return (
    <div style={{ padding: '12px 16px', height: maxHeight, overflow: 'auto' }}>
      {outputs.length === 0 ? (
        <Empty description="暂无子模型输出" style={{ marginTop: 48 }} />
      ) : (
        <List
          dataSource={sortedOutputs}
          renderItem={(output: ChildAgentOutput) => {
            return (
              <div
                key={output.id}
                style={{
                  marginBottom: 12,
                  padding: '12px',
                  borderRadius: 8,
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                }}
              >
                <Space size={8} style={{ marginBottom: 8 }}>
                  <RobotOutlined style={{ color: '#eb2f96' }} />
                  <Tag color="#eb2f96" style={{ margin: 0, fontSize: 11 }}>
                    {output.name || 'Unknown Agent'}
                  </Tag>
                  <Tag
                    color={getStatusColor(output.status)}
                    icon={
                      output.status === 'completed' ? <CheckCircleOutlined /> :
                      output.status === 'error' ? <CloseCircleOutlined /> :
                      output.status === 'running' ? <LoadingOutlined spin /> : undefined
                    }
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {getStatusText(output.status)}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatDuration(output.duration)}
                  </Text>
                </Space>

                <Collapse
                  size="small"
                  ghost
                  items={[
                    {
                      key: 'input',
                      label: <Text type="secondary" style={{ fontSize: 12 }}>输入参数</Text>,
                      children: output.input ? (
                        <div style={{ position: 'relative' }}>
                          <pre style={{
                            background: '#f5f5f5',
                            padding: '8px 12px',
                            borderRadius: 6,
                            margin: 0,
                            maxHeight: 150,
                            overflow: 'auto',
                            fontSize: 11,
                            fontFamily: 'Consolas, Monaco, monospace',
                          }}>
                            {formatJson(output.input)}
                          </pre>
                          <Tooltip title="复制">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyToClipboard(formatJson(output.input))}
                              style={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                              }}
                            />
                          </Tooltip>
                        </div>
                      ) : null,
                    },
                    {
                      key: 'output',
                      label: <Text type="secondary" style={{ fontSize: 12 }}>输出内容</Text>,
                      children: output.output ? (
                        <div style={{ position: 'relative' }}>
                          <pre style={{
                            background: '#f6ffed',
                            padding: '8px 12px',
                            borderRadius: 6,
                            margin: 0,
                            maxHeight: 200,
                            overflow: 'auto',
                            fontSize: 11,
                            fontFamily: 'Consolas, Monaco, monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {typeof output.output === 'string' ? output.output : formatJson(output.output)}
                          </pre>
                          <Tooltip title="复制">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyToClipboard(
                                typeof output.output === 'string' ? output.output : formatJson(output.output)
                              )}
                              style={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                              }}
                            />
                          </Tooltip>
                        </div>
                      ) : null,
                    },
                  ]}
                />
              </div>
            );
          }}
        />
      )}
    </div>
  );
};

export default ChildAgentOutputPanel;
