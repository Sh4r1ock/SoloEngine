import React, { useState, useEffect, useRef } from 'react';
import { Slider, Button, Space, Typography, Card, Progress } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface ReplayStep {
  step_id: string;
  timestamp: string;
  data: any;
}

interface ReplayPlayerProps {
  steps: ReplayStep[];
  onStepChange?: (stepIndex: number, step: ReplayStep) => void;
}

const ReplayPlayer: React.FC<ReplayPlayerProps> = ({ steps, onStepChange }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPlaying && steps.length > 0) {
      intervalRef.current = setInterval(() => {
        setCurrentStep((prev) => {
          const next = prev + 1;
          if (next >= steps.length) {
            setIsPlaying(false);
            return prev;
          }
          onStepChange?.(next, steps[next]);
          return next;
        });
      }, 1000 / speed);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, speed, steps, onStepChange]);

  const handlePlay = () => {
    if (currentStep >= steps.length - 1) {
      setCurrentStep(0);
      onStepChange?.(0, steps[0]);
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleStepBackward = () => {
    setIsPlaying(false);
    const prev = Math.max(0, currentStep - 1);
    setCurrentStep(prev);
    onStepChange?.(prev, steps[prev]);
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    const next = Math.min(steps.length - 1, currentStep + 1);
    setCurrentStep(next);
    onStepChange?.(next, steps[next]);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStep(0);
    onStepChange?.(0, steps[0]);
  };

  const handleSliderChange = (value: number) => {
    setIsPlaying(false);
    setCurrentStep(value);
    onStepChange?.(value, steps[value]);
  };

  if (steps.length === 0) {
    return <Text type="secondary">无步骤可回放</Text>;
  }

  return (
    <Card size="small">
      <Space direction="vertical" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text>
            步骤 {currentStep + 1} / {steps.length}
          </Text>
          <Text type="secondary">
            速度: {speed}x
          </Text>
        </div>

        <Slider
          min={0}
          max={steps.length - 1}
          value={currentStep}
          onChange={handleSliderChange}
          style={{ width: '100%' }}
        />

        <Space style={{ width: '100%', justifyContent: 'center' }}>
          <Button icon={<StepBackwardOutlined />} onClick={handleStepBackward} />
          {isPlaying ? (
            <Button icon={<PauseCircleOutlined />} onClick={handlePause} />
          ) : (
            <Button icon={<PlayCircleOutlined />} onClick={handlePlay} />
          )}
          <Button icon={<StepForwardOutlined />} onClick={handleStepForward} />
          <Button icon={<ReloadOutlined />} onClick={handleReset} />
        </Space>

        <Slider
          min={0.5}
          max={4}
          step={0.5}
          value={speed}
          onChange={setSpeed}
          tooltip={{ formatter: (value) => `${value}x` }}
          style={{ width: '100%' }}
        />
      </Space>
    </Card>
  );
};

export default ReplayPlayer;
