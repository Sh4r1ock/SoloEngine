import React, { useEffect, useState } from 'react';
import { Modal, Space, Typography, Select, Tag, Input, Tooltip, App, Switch } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useCanvasStore } from '../../store/canvasStore';

const { Text } = Typography;

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

type RunMode = 'auto' | 'ask' | 'allowlist';

const RUN_MODE_OPTIONS: { value: RunMode; label: string }[] = [
  { value: 'ask', label: '每次询问' },
  { value: 'allowlist', label: '白名单模式' },
  { value: 'auto', label: '自动运行' },
];

const RUN_MODE_TIP = '每次询问：所有命令执行前需您批准；白名单模式：白名单内命令自动执行，其余需批准；自动运行：命令直接执行';

const FOLLOW_MODE_TIP = '开启：Agent 调用工具时，操作区自动跳转到对应标签页（如调用 Read/Write 跳转编辑器、调用 RunCommand 跳转终端），实时跟随 Agent 操作；关闭：仅打开对应页面与文件，不强制跳转，保留您当前查看的标签页。';

/**
 * agenticflow 画布设置弹窗。
 *
 * 说明：
 * - maxContextLength / maxIterations / timeout 等 agent 级参数已迁移至 LLM 配置
 *   （llm_config 默认值 → 画布节点 model_config → canvas_data），此处不再展示。
 * - LLM 配置管理请前往主菜单「LLM」标签页，此处不重复提供。
 * - 此处仅保留画布级运行行为：权限模式 + 命令白名单（白名单模式时显示，可增删）。
 * - 白名单列表采用 antd 官方动态 Tag 成熟模式（Tag 流式排列 + 输入框回车添加 + 点击 × 删除）。
 */
const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose }) => {
  const { globalSettings, setGlobalSettings } = useCanvasStore();
  const { message } = App.useApp();
  const [runMode, setRunMode] = useState<RunMode>(globalSettings.runMode || 'ask');
  const [allowlist, setAllowlist] = useState<string[]>(globalSettings.commandAllowlist || []);
  const [followMode, setFollowMode] = useState<boolean>(globalSettings.followMode ?? true);
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    if (visible) {
      setRunMode(globalSettings.runMode || 'ask');
      setAllowlist(globalSettings.commandAllowlist || []);
      setFollowMode(globalSettings.followMode ?? true);
      setNewItem('');
    }
  }, [visible, globalSettings]);

  /** 添加白名单条目 */
  const addItem = () => {
    const v = newItem.trim();
    if (!v) return;
    setAllowlist((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setNewItem('');
  };

  /** 删除白名单条目 */
  const removeItem = (index: number) => {
    setAllowlist((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    // 白名单：去空白、过滤空项、去重后保存为数组
    const cleaned: string[] = [...new Set(allowlist.map((s) => String(s).trim()).filter(Boolean))];
    setGlobalSettings({
      runMode: runMode || 'ask',
      commandAllowlist: cleaned,
      followMode,
    });
    message.success('全局设置已保存');
    onClose();
  };

  return (
    <Modal
      title="设置"
      open={visible}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      width={640}
      style={{ top: 20 }}
    >
      <div style={{ padding: '8px 0' }}>
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space size={4}>
            <Text strong>实时跟随</Text>
            <Tooltip title={FOLLOW_MODE_TIP}>
              <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 14, cursor: 'help' }} />
            </Tooltip>
          </Space>
          <Switch
            checked={followMode}
            onChange={(checked) => setFollowMode(checked)}
            size="small"
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 8 }}>
            <Space size={4}>
              <Text strong>权限模式</Text>
              <Tooltip title={RUN_MODE_TIP}>
                <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 14, cursor: 'help' }} />
              </Tooltip>
            </Space>
          </div>
          <Select<RunMode>
            value={runMode}
            onChange={(value) => setRunMode(value)}
            style={{ width: '100%' }}
            options={RUN_MODE_OPTIONS}
          />
        </div>

        {runMode === 'allowlist' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 8 }}>
              <Space size={4}>
                <Text strong>白名单列表</Text>
                <Tooltip title="白名单内命令前缀自动执行；白名单外命令执行前需您批准。输入命令前缀后回车添加，点击标签 × 可删除。">
                  <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 14, cursor: 'help' }} />
                </Tooltip>
              </Space>
            </div>
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onPressEnter={addItem}
              placeholder="输入命令前缀后回车添加，例如：npm、git、python"
              style={{ marginBottom: 8 }}
            />
            <Space size={[8, 8]} wrap>
              {allowlist.map((item, index) => (
                <Tag
                  key={`${index}-${item}`}
                  closable
                  onClose={() => removeItem(index)}
                  style={{ userSelect: 'none', marginInlineEnd: 0 }}
                >
                  {item}
                </Tag>
              ))}
              {allowlist.length === 0 && (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  暂无条目，请在上方输入命令前缀后回车添加
                </Text>
              )}
            </Space>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SettingsModal;
