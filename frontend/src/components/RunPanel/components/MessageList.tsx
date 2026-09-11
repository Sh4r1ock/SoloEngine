import React, { useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle, useState } from 'react';
import { Typography, Tooltip, App, Button, Input, Space, Tag, Radio, Checkbox } from 'antd';
import { RobotOutlined, UndoOutlined, DeleteOutlined, FileAddOutlined, CloseCircleOutlined, CloseOutlined, ExclamationCircleOutlined, InfoCircleOutlined, LoadingOutlined, GlobalOutlined } from '@ant-design/icons';
import { useRunPanelStore } from '../stores/runPanelStore';
import type { LLMMessage, SystemMessage, Message, DataBlock, FileChangeInfo, TokenTotals } from '../types';
import BeautifulMarkdownRenderer from '../../common/BeautifulMarkdownRenderer';
import FileChangePanel from './FileChangePanel';
import AutoScrollContainer from './AutoScrollContainer';
import { formatSmartTime } from '../../../utils/timezone';
import { copyToClipboard } from '../utils/dataBlockUtils';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { fileChangesApi } from '../../../services/fileChangesApi';
import ConfirmDialog from '../../common/ConfirmDialog';
import { getFileIcon } from '../../../utils/fileIcon';
import '../styles/FileChangeStyles.css';

const { Text } = Typography;

const SUBAGENT_BASE_COLOR = '#3F51B5';
const FILE_OP_TOOLS = new Set(['Write', 'SearchReplace', 'DeleteFile', 'write_file', 'search_replace', 'delete_file', 'create_file', 'edit_file']);

const getSubagentColor = (depth: number): string => {
  if (depth === 0) return 'transparent';
  const level = ((depth - 1) % 4) + 1;
  const opacityMap: Record<number, number> = { 1: 0.4, 2: 0.6, 3: 0.8, 4: 1.0 };
  const opacity = opacityMap[level];
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${SUBAGENT_BASE_COLOR}${alpha}`;
};

interface AgentGroup {
  agent_id: string;
  agent_name: string;
  agent_level: number;
  blocks: DataBlock[];
  agent_tokens?: number;
  /** 组级整轮累计（后端聚合改造：subagent 组头回显用，与流式 agentUsageMap 同构） */
  group_agent_tokens?: number;
  group_agent_totals?: TokenTotals;
  group_agent_history?: any[];
  /** 组实例标识（session_message_id）：流式由 agent_start 事件 metadata.message_id 注入、
   *  回显由 build_flattened_blocks 注入消息 id——组头 token 按 message_id 查询
   *  agentUsageMap（同 agent 并发 N 实例各独立，不被后一次调用覆盖） */
  message_id?: string;
  /** tc.id 方案：产生该子执行的 tool_call id（流式 agent_start source_tool_call_id 注入
   *  块、回显由 run_api 从 task 消息注入子组块）——前端在子组出现时按 tc.id 精确嵌套
   *  （流式/回显统一对号） */
  sourceToolCallId?: string;
  /** 分组唯一键 = agent_id + message_id（同 agent 并发 N 实例 message_id 不同各独立成组） */
  instanceKey?: string;
}

const groupDataBlocksByAgent = (blocks: DataBlock[]): AgentGroup[] => {
  const groups: AgentGroup[] = [];
  // 〇·3 并发修复（TA10 流式碎片化根因）：分组不能依赖"同实例块在 blocks 数组中
  // 连续存放"——并发 N 实例（asyncio.gather）的 WS 事件流天然交错，各实例的类型
  // 切换（reasoning→content→tool_calls）交错触发 finalize，导致同实例块被其他实例
  // 块隔开。因此改为按 instanceKey（agent_id + message_id）归组：遍历时把每个
  // 块归入所属实例组（组内块保持输出顺序），组顺序 = 首次出现顺序（mainagent 在前、
  // 各 subagent 实例按事件到达顺序，与回显 build_flattened_blocks 的消息顺序一致）。
  // 回显路径同实例块本就连续，归组结果与相邻分组一致，行为不变。
  const groupMap = new Map<string, AgentGroup>();
  for (const block of blocks) {
    const agentId = block.agent_id || 'default';
    const agentName = block.agent_name || 'AI助手';
    const agentLevel = block.agent_level || 0;
    // 分组键 = agent_id + message_id（回显由后端 build_flattened_blocks
    // 注入实例唯一键 root_task_id / 流式由 processStreamChunk 注入 message_id），
    // 同 agent 并发 N 实例（TA10）各独立成组、组头 token 独立显示，不再被合并为 1 组。
    const instanceKey = `${agentId}|${block.message_id || ''}`;
    let group = groupMap.get(instanceKey);
    if (!group) {
      group = {
        instanceKey,
        agent_id: agentId,
        agent_name: agentName,
        agent_level: agentLevel,
        blocks: [],
        agent_tokens: block.agent_tokens,
        group_agent_tokens: block.group_agent_tokens,
        group_agent_totals: block.group_agent_totals,
        group_agent_history: block.group_agent_history,
        message_id: block.message_id,
        // tc.id 方案：流式子组归属（agent_start source_tool_call_id 注入块）
        sourceToolCallId: block.source_tool_call_id,
      };
      groupMap.set(instanceKey, group);
      groups.push(group);
    }
    group.blocks.push(block);
  }
  return groups;
};

const ThoughtBlock = React.memo(({ block, isExpanded, onToggle, blockKey }: {
  block: DataBlock;
  isExpanded: boolean;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKey: string;
}) => {
  return (
    <div style={{ width: '100%' }}>
      <div onClick={() => onToggle(block, blockKey, isExpanded)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: 12, color: 'var(--text-200)', width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>ⓘ</span>
        <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>Thought</Text>
      </div>
      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'row', marginTop: 4 }}>
          <div style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: 2, background: 'var(--bg-300)' }} />
          </div>
          <AutoScrollContainer maxHeight="50vh" dependency={block.reasoning_content} style={{ transition: 'max-height 0.5s ease-in-out', marginTop: 0, flex: 1 }}>
            <div style={{ flex: 1, minWidth: 0, padding: '0 0 6px 6px', fontSize: 12, color: 'var(--text-200)', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
              {block.reasoning_content}
            </div>
          </AutoScrollContainer>
        </div>
      )}
    </div>
  );
}, (prev, next) => prev.block === next.block && prev.isExpanded === next.isExpanded);

const ToolCallsBlock = React.memo(({ block, msgId, onToggle, blockKey, fileChangesMap, allBlocks, onFileClick, subGroupRenderers = {} }: {
  block: DataBlock;
  msgId: string;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKey: string;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  allBlocks?: DataBlock[];
  onFileClick?: (filePath: string) => void;
  /** tc.id 对号插槽：tc.id → 该 tc 的子 subagent 组渲染（AgentGroupItem 构造），
   *  每个 tc 徽标下交错嵌套其子组（task → subagent → task → subagent，非块后追加） */
  subGroupRenderers?: Record<string, React.ReactNode>;
}) => {
  const expandedBlockKeys = useRunPanelStore(state => state.expandedBlockKeys);
  const userAnswerSender = useRunPanelStore(state => state.userAnswerSender);
  const openAgenticPanel = useRunPanelStore(state => state.openAgenticPanel);
  const [planModifyText, setPlanModifyText] = useState('');
  // AskUserQuestion 分页卡片状态：一个问题一页，div 内跳转（上一步/下一步/确认，无取消无跳过，留空即跳过）
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, any>>({});
  const [customAnswerText, setCustomAnswerText] = useState<string>('');
  const [supplementText, setSupplementText] = useState<string>('');

  const streamingFileChanges = useMemo(() => {
    return (allBlocks?.filter(b => b.type === 'file_changes') || []).flatMap(b => b.file_changes || []);
  }, [allBlocks]);

  const streamingPreviewChanges = useMemo(() => {
    return streamingFileChanges.filter((fileChange: any) => fileChange._preview);
  }, [streamingFileChanges]);

  const apiFileChanges: FileChangeInfo[] = fileChangesMap[msgId] || [];

  return (
    <>
      {block.tool_calls?.map((tc, tcIdx) => {
        const toolName = tc.function?.name || '';
        const isFileOpTool = FILE_OP_TOOLS.has(toolName);
        const toolArgs = (() => {
          try { return typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments; }
          catch { return null; }
        })();
        const toolFilePath = toolArgs?.path || toolArgs?.file_path || toolArgs?.filename;
        const toolKey = `${blockKey}-tc-${tcIdx}`;
        const toolExpanded = expandedBlockKeys[toolKey] ?? block._isExpanding ?? false;
        const matchedChanges = isFileOpTool ? (() => {
          const previewMatches = streamingPreviewChanges.filter((fileChange: any) => tc.id && fileChange.tool_call_id && fileChange.tool_call_id === tc.id);
          if (previewMatches.length > 0) return previewMatches;
          const apiMatches = apiFileChanges.filter((fileChange: any) => tc.id && fileChange.tool_call_id && fileChange.tool_call_id === tc.id);
          if (apiMatches.length > 0) return apiMatches;
          return apiFileChanges.filter((fileChange: any) => {
            if (!toolFilePath) return false;
            const changeFilePath = fileChange.file_path?.replace(/\\/g, '/');
            const normalizedToolFilePath = toolFilePath?.replace(/\\/g, '/');
            return changeFilePath === normalizedToolFilePath || changeFilePath?.endsWith(normalizedToolFilePath) || normalizedToolFilePath?.endsWith(changeFilePath);
          });
        })() : [];

        return (
          <div key={tcIdx} style={{ width: '100%' }}>
            <div onClick={() => onToggle(block, toolKey, toolExpanded)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: 12, color: 'var(--text-200)', width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>⚙︎</span>
              <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>{tc.function?.name}</Text>
              {matchedChanges.length > 0 && matchedChanges.map((fileChange: any, i: number) => {
                const fileName = fileChange.file_path?.split(/[\\/]/).pop() || '';
                if (fileChange.operation === 'deleted') {
                  return (<React.Fragment key={i}><span style={{ flex: 1 }} /><span className="sc-tool-fc-name" onClick={(e) => { e.stopPropagation(); onFileClick?.(fileChange.file_path); }} title={`点击打开: ${fileChange.file_path}`}>{fileName}</span><DeleteOutlined style={{ fontSize: 11, color: '#ff4d4f', marginLeft: 6 }} /></React.Fragment>);
                }
                const added = fileChange.diff?.lines_added ?? 0;
                const removed = fileChange.diff?.lines_removed ?? 0;
                return (<React.Fragment key={i}><span style={{ flex: 1 }} /><span className="sc-tool-fc-name" onClick={(e) => { e.stopPropagation(); onFileClick?.(fileChange.file_path); }} title={`点击打开: ${fileChange.file_path}`}>{fileName}</span><FileAddOutlined style={{ fontSize: 11, color: '#52c41a', marginLeft: 6 }} /><Text style={{ fontSize: 11, marginLeft: 4 }}><span style={{ color: '#52c41a' }}>+{added}</span><span style={{ color: '#ff4d4f', marginLeft: 4 }}>-{removed}</span></Text></React.Fragment>);
              })}
            </div>
            {toolName === 'AskUserQuestion' && !tc.result && userAnswerSender && (() => {
              const OTHER_LABEL = '其他';
              const questions: any[] = Array.isArray(toolArgs?.questions) ? toolArgs.questions : [];
              if (questions.length === 0) return null;
              // 默认追加"补充信息"输入页（前端自动附加，AI 无需显式传该题）：直接一个输入框，
              // 不做"是否需要补充信息？需要/不需要"选项——空提交/取消即跳过
              const supplementQ: any = {
                question: '是否有更多的补充信息需要提供？（可选）',
              };
              const allQuestions: any[] = [...questions, supplementQ];
              const total = allQuestions.length;
              const currentQuestion: any = allQuestions[questionIndex] || allQuestions[0];
              const isLast = questionIndex === total - 1;
              const isSupplement = currentQuestion.question === supplementQ.question;
              const navHint = isSupplement ? '其他补充' : '下一步';

              const getAnswer = (question: any): any => questionAnswers[question.question];
              const setAnswer = (question: any, value: any) => setQuestionAnswers(prev => ({ ...prev, [question.question]: value }));

              const toggleOption = (question: any, label: string) => {
                if (question.multiSelect) {
                  const answers: string[] = Array.isArray(getAnswer(question)) ? getAnswer(question) : [];
                  setAnswer(question, answers.includes(label) ? answers.filter(option => option !== label) : [...answers, label]);
                } else {
                  setAnswer(question, label);
                }
              };

              const isOptionSelected = (question: any, label: string): boolean => {
                const value = getAnswer(question);
                if (question.multiSelect) return Array.isArray(value) && value.includes(label);
                return value === label;
              };

              const isOtherSelected = (question: any): boolean => isOptionSelected(question, OTHER_LABEL);

              // 记录当前题答案："其他"输入内容优先（单选替换为输入内容；多选将"其他"替换为输入内容）；未作答=跳过不记录
              const commitCurrent = () => {
                if (isOtherSelected(currentQuestion) && customAnswerText.trim()) {
                  if (currentQuestion.multiSelect) {
                    const answers: string[] = Array.isArray(getAnswer(currentQuestion)) ? getAnswer(currentQuestion).filter((option: string) => option !== OTHER_LABEL) : [];
                    setAnswer(currentQuestion, [...answers, customAnswerText.trim()]);
                  } else {
                    setAnswer(currentQuestion, customAnswerText.trim());
                  }
                  setCustomAnswerText('');
                }
              };

              const handleNext = () => {
                commitCurrent();
                setQuestionIndex(i => Math.min(i + 1, total - 1));
              };

              const handlePrev = () => {
                commitCurrent();
                setQuestionIndex(i => Math.max(i - 1, 0));
              };

              // 提交答案（cancel=true 时空提交，全部答案为 null，后端按跳过处理）
              const submitAnswers = (cancel: boolean) => {
                commitCurrent();
                const result: Record<string, any> = {};
                questions.forEach(question => { result[question.question] = cancel ? null : (questionAnswers[question.question] ?? null); });
                result[supplementQ.question] = cancel ? null : (supplementText.trim() || null);
                userAnswerSender?.(JSON.stringify({ answers: result }), tc.id);
                setQuestionIndex(0); setQuestionAnswers({}); setCustomAnswerText(''); setSupplementText('');
              };

              // 选项行：整行块样式（参考 Trae Solo 图片：label 粗体一行、description 换行其下，
              // 整行可点、行有完整区块）；"其他"行选中时将输入框换行内嵌到该行
              const renderOption = (question: any, option: any) => {
                const selected = isOptionSelected(question, option.label);
                const isOther = option.label === OTHER_LABEL;
                return (
                  <div
                    key={option.label}
                    onClick={() => toggleOption(question, option.label)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8,
                      background: selected ? 'var(--bg-100)' : 'transparent',
                      cursor: 'pointer', fontSize: 12, color: 'var(--text-100)',
                    }}
                  >
                    <span style={{ marginTop: 1, lineHeight: '18px' }}>{question.multiSelect ? <Checkbox checked={selected} /> : <Radio checked={selected} />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: selected ? 500 : 400, lineHeight: '18px' }}>{option.label}</div>
                      {isOther && selected ? (
                        <div className="hitl-underlined-input-wrap" style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
                          <Input.TextArea
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            value={customAnswerText}
                            onChange={e => setCustomAnswerText(e.target.value)}
                            placeholder="请输入"
                            maxLength={1000}
                            showCount
                          />
                        </div>
                      ) : (
                        option.description ? <div style={{ fontSize: 11, color: 'var(--text-300)', lineHeight: '16px', marginTop: 2 }}>{option.description}</div> : null
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <div className="hitl-card" style={{ margin: '8px 0 0 20px', padding: 12, background: 'var(--bg-200)', borderRadius: 8, border: '1px solid var(--border-100)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <Tag color="geekblue" style={{ marginRight: 0 }}>提问</Tag>

                  <div style={{ marginTop: 10 }}>
                    <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>
                      {/* 只显示问题文本：header 为 AI 传参（后端校验/格式化用），前端不再单独渲染，
                          避免"header+question"拼接重复（如"部署方式你更倾向于使用哪种部署方式？"） */}
                      {currentQuestion.question}
                      {currentQuestion.multiSelect ? <Text type="secondary" style={{ fontSize: 11 }}>（可多选）</Text> : null}
                    </Text>

                    {!isSupplement && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                        {(currentQuestion.options || []).map((option: any) => renderOption(currentQuestion, option))}
                        {/* 自定义回答 = "其他"选项，与选项列表合并；选中后该行展开内嵌输入框（换行于 label 下方） */}
                        {renderOption(currentQuestion, { label: OTHER_LABEL, description: '自定义回答' })}
                      </div>
                    )}

                    {isSupplement && (
                      <div className="hitl-supplement-wrap" style={{ position: 'relative', marginTop: 8 }}>
                        <Input.TextArea
                          autoSize={{ minRows: 1, maxRows: 6 }}
                          value={supplementText}
                          onChange={e => setSupplementText(e.target.value)}
                          placeholder="添加补充信息"
                          maxLength={1000}
                          showCount
                        />
                      </div>
                    )}
                  </div>

                  {/* 底部：左侧进度/提示，右侧 取消/上一步/下一步（取消=空提交，复用空提交，后端按跳过处理） */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12 }}>
                    <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>{questionIndex + 1}/{total} {navHint}</Text>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="small" onClick={() => submitAnswers(true)}>取消</Button>
                      {questionIndex > 0 && <Button size="small" onClick={handlePrev}>上一步</Button>}
                      {!isLast && (
                        <Button size="small" type="primary" onClick={handleNext}>下一步</Button>
                      )}
                      {isLast && (
                        <Button size="small" type="primary" onClick={() => submitAnswers(false)}>提交</Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
            {toolName === 'EnterPlanMode' && !tc.result && userAnswerSender && (() => {
              const reason: string = typeof toolArgs?.reason === 'string' ? toolArgs.reason : '';
              return (
                <div className="hitl-card" style={{ margin: '8px 0 0 20px', padding: 12, background: 'var(--bg-200)', borderRadius: 8, border: '1px solid var(--border-100)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <Space align="center" size={6}>
                    <Tag color="purple" style={{ marginRight: 0 }}>计划模式</Tag>
                    <Text style={{ fontSize: 12, color: 'var(--text-200)' }}>是否允许进入计划模式？</Text>
                  </Space>
                  {reason && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-100)' }}>
                      <Text strong style={{ fontSize: 12 }}>原因：</Text>
                      <span>{reason}</span>
                    </div>
                  )}
                  {/* 底部栏：左侧提示 + 右侧按钮组（主操作"批准"在最右，主题蓝 primary） */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12 }}>
                    <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>进入后处于只读模式，禁止修改文件或执行命令</Text>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="small" onClick={() => userAnswerSender?.('【驳回】不允许进入计划模式。', tc.id)}>驳回</Button>
                      <Button size="small" type="primary" onClick={() => userAnswerSender?.('【批准】允许进入计划模式。', tc.id)}>批准</Button>
                    </div>
                  </div>
                </div>
              );
            })()}
            {(() => {
              // 修改类工具被 Plan 模式守卫拦截：工具结果 plan_mode_blocked: true 时渲染提示
              try {
                const resultObj = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
                if (resultObj && resultObj.plan_mode_blocked === true) {
                  return (
                    <div className="hitl-card" style={{ margin: '8px 0 0 20px', padding: '8px 12px', background: 'var(--bg-200)', borderRadius: 8, border: '1px solid var(--border-100)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                      <Space align="center" size={6}>
                        <Tag color="warning" style={{ marginRight: 0 }}>计划模式</Tag>
                        <Text style={{ fontSize: 12, color: 'var(--text-200)' }}>计划模式下禁止修改操作（read-only），请调用 ExitPlanMode 提交计划并获得批准后再执行。</Text>
                      </Space>
                    </div>
                  );
                }
              } catch { /* 非 JSON 结果不做解析 */ }
              return null;
            })()}
            {toolName === 'ExitPlanMode' && !tc.result && userAnswerSender && (() => {
              const planContent: string = typeof toolArgs?.plan_content === 'string' ? toolArgs.plan_content : '';
              const planSteps: string[] = Array.isArray(toolArgs?.plan_steps) ? toolArgs.plan_steps : [];
              return (
                <div className="hitl-card" style={{ margin: '8px 0 0 20px', padding: 12, background: 'var(--bg-200)', borderRadius: 8, border: '1px solid var(--border-100)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <Space align="center" size={6}>
                    <Tag color="gold" style={{ marginRight: 0 }}>计划审批</Tag>
                    <Text style={{ fontSize: 12, color: 'var(--text-200)' }}>请审阅计划并作出决策</Text>
                  </Space>
                  {planContent && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-100)' }}>
                      <BeautifulMarkdownRenderer>{planContent}</BeautifulMarkdownRenderer>
                    </div>
                  )}
                  {planSteps.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-100)', marginTop: 8 }}>
                      <Text strong style={{ fontSize: 12 }}>执行步骤：</Text>
                      <ol style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
                        {planSteps.map((s: string, i: number) => (
                          <li key={i} style={{ marginTop: 2 }}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {/* 修改意见：下划线输入框（与 AskUserQuestion 输入同风格，公共 CSS 见 index.css .hitl-card） */}
                  <div className="hitl-underlined-input-wrap" style={{ marginTop: 8 }}>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      value={planModifyText}
                      onChange={(e) => setPlanModifyText(e.target.value)}
                      placeholder="输入修改意见后提交"
                      maxLength={1000}
                      showCount
                    />
                  </div>
                  {/* 底部栏：左侧提示 + 右侧按钮组（主操作"执行"在最右，主题蓝 primary） */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12 }}>
                    <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>审阅计划后作出决策</Text>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="small" onClick={() => {
                        if (planModifyText.trim()) {
                          userAnswerSender?.(`【修改】${planModifyText.trim()}`, tc.id);
                          setPlanModifyText('');
                        }
                      }}>提交修改</Button>
                      <Button size="small" onClick={() => userAnswerSender?.('【跳过】跳过该计划，请勿执行。', tc.id)}>跳过</Button>
                      <Button size="small" type="primary" onClick={() => userAnswerSender?.('【执行】计划已批准，请开始执行。', tc.id)}>执行</Button>
                    </div>
                  </div>
                </div>
              );
            })()}
            {toolName === 'RunCommand' && !tc.result && userAnswerSender && (
              <div className="hitl-card" style={{ margin: '8px 0 0 20px', padding: 12, background: 'var(--bg-200)', borderRadius: 8, border: '1px solid var(--border-100)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <Space align="center" size={6}>
                  <Tag color="orange" style={{ marginRight: 0 }}>命令审批</Tag>
                  <Text style={{ fontSize: 12, color: 'var(--text-200)' }}>命令执行需要您的批准</Text>
                </Space>
                <div style={{ fontSize: 12, color: 'var(--text-100)', marginTop: 10, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', fontFamily: 'Consolas, monospace', background: 'var(--bg-100)', padding: '6px 8px', borderRadius: 4 }}>
                  {typeof toolArgs?.command === 'string' ? toolArgs.command : JSON.stringify(toolArgs)}
                </div>
                {/* 底部栏：左侧提示 + 右侧按钮组（主操作"执行"在最右，主题蓝 primary） */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>批准后执行命令</Text>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="small" onClick={() => userAnswerSender?.('【取消】取消执行该命令。', tc.id)}>取消</Button>
                    <Button size="small" type="primary" onClick={() => userAnswerSender?.('【执行】允许执行该命令。', tc.id)}>执行</Button>
                  </div>
                </div>
              </div>
            )}
            {toolName === 'DeleteFile' && !tc.result && userAnswerSender && (() => {
              const paths: string[] = Array.isArray(toolArgs?.file_paths) ? toolArgs.file_paths : [];
              return (
                <div className="hitl-card" style={{ margin: '8px 0 0 20px', padding: 12, background: 'var(--bg-200)', borderRadius: 8, border: '1px solid var(--border-100)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <Space align="center" size={6}>
                    <Tag color="red" style={{ marginRight: 0 }}>删除确认</Tag>
                    <Text style={{ fontSize: 12, color: 'var(--text-200)' }}>删除操作需要您的批准（不可恢复）</Text>
                  </Space>
                  <div style={{ fontSize: 12, color: 'var(--text-100)', marginTop: 10, fontWeight: 500 }}>将删除以下文件：</div>
                  {paths.map((p: string) => (
                    <div key={p} style={{ fontSize: 12, color: 'var(--text-100)', marginTop: 4, fontFamily: 'Consolas, monospace', background: 'var(--bg-100)', padding: '4px 8px', borderRadius: 4, overflowWrap: 'break-word' }}>
                      {p}
                    </div>
                  ))}
                  {/* 底部栏：左侧提示 + 右侧按钮组（主操作"执行"在最右，主题蓝 primary） */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12 }}>
                    <Text style={{ fontSize: 11, color: 'var(--text-300)' }}>删除操作不可恢复，请谨慎确认</Text>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="small" onClick={() => userAnswerSender?.('【取消】取消删除。', tc.id)}>取消</Button>
                      <Button size="small" type="primary" onClick={() => userAnswerSender?.('【执行】确认删除这些文件。', tc.id)}>执行</Button>
                    </div>
                  </div>
                </div>
              );
            })()}
            {toolName === 'OpenPreview' && toolArgs?.preview_url && (
              <div className="hitl-card" style={{ margin: '8px 0 0 20px', padding: 12, background: 'var(--bg-200)', borderRadius: 8, border: '1px solid var(--border-100)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {/* 可跳转块：点击后在右侧 Agentic 操作区浏览器面板打开预览页面（真实可用，非占位） */}
                <div
                  onClick={() => openAgenticPanel('browser', toolArgs.preview_url)}
                  title={`点击在操作区打开: ${toolArgs.preview_url}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: 'var(--bg-100)',
                    border: '1px solid var(--border-100)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary-100)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(63, 81, 181, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-100)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <GlobalOutlined style={{ color: 'var(--primary-100)', fontSize: 14, flexShrink: 0 }} />
                  <Text style={{ fontSize: 12, color: 'var(--primary-100)', overflowWrap: 'break-word', flex: 1 }}>{toolArgs.preview_url}</Text>
                </div>
              </div>
            )}
            {toolExpanded && (
              <div style={{ display: 'flex', flexDirection: 'row', marginTop: 4 }}>
                <div style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ width: 2, background: 'var(--bg-300)' }} />
                </div>
                <AutoScrollContainer maxHeight="50vh" dependency={`${tc.function?.arguments}${tc.result}`} style={{ transition: 'max-height 0.5s ease-in-out', marginTop: 0, flex: 1 }}>
                  <div style={{ flex: 1, minWidth: 0, padding: '0 0 6px 6px', fontSize: 12, color: 'var(--text-200)', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                    参数: {tc.function?.arguments}
                    {tc.result && (
                      <div style={{ marginTop: 6 }}>
                        <span style={{ fontWeight: 500 }}>结果:</span>
                        {(() => {
                          try {
                            const parsed = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
                            if (parsed && typeof parsed === 'object') {
                              return (<div style={{ marginTop: 4 }}>{Object.entries(parsed).map(([key, value]) => (<div key={key} style={{ marginTop: 2 }}><span style={{ fontWeight: 500, color: 'var(--text-200)' }}>{key}:</span>{' '}<span style={{ color: 'var(--text-100)' }}>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</span></div>))}</div>);
                            }
                          } catch { return ` ${tc.result}`; }
                          return ` ${tc.result}`;
                        })()}
                      </div>
                    )}
                    </div>
                </AutoScrollContainer>
              </div>
            )}
            {subGroupRenderers[tc.id] && (
              <div style={{ marginTop: 4 }}>{subGroupRenderers[tc.id]}</div>
            )}
          </div>
        );
      })}
    </>
  );
}, (prev, next) => prev.block === next.block && prev.fileChangesMap === next.fileChangesMap && prev.allBlocks === next.allBlocks && prev.subGroupRenderers === next.subGroupRenderers);

const ContentBlock = React.memo(({ content }: { content: string }) => {
  return <BeautifulMarkdownRenderer>{content || ''}</BeautifulMarkdownRenderer>;
}, (prev, next) => prev.content === next.content);

const DataBlockItem = React.memo(({ block, idx, msgId, onToggle, blockKey, fileChangesMap, allBlocks, onFileClick, subGroupRenderers = {} }: {
  block: DataBlock;
  idx: number;
  msgId: string;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKey: string;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  allBlocks?: DataBlock[];
  onFileClick?: (filePath: string) => void;
  /** tc.id 对号插槽（透传给 ToolCallsBlock）：每个 tc 徽标下交错嵌套其子组 */
  subGroupRenderers?: Record<string, React.ReactNode>;
}) => {
  const isExpanded = useRunPanelStore(state => state.expandedBlockKeys[blockKey] ?? block._isExpanding ?? false);

  // 注意：_is_compaction 块已在 AgentGroupItem 中合并为 CompactionBubble（blocks 组），
  // 此处不再单独处理（流式/回显同一路径，避免双渲染）。
  if (block.type === 'reasoning_content') {
    return <ThoughtBlock block={block} isExpanded={isExpanded} onToggle={onToggle} blockKey={blockKey} />;
  }
  if (block.type === 'tool_calls') {
    return <ToolCallsBlock block={block} msgId={msgId} onToggle={onToggle} blockKey={blockKey} fileChangesMap={fileChangesMap} allBlocks={allBlocks} onFileClick={onFileClick} subGroupRenderers={subGroupRenderers} />;
  }
  if (block.type === 'content') {
    return <ContentBlock content={block.content || ''} />;
  }
  return null;
}, (prev, next) => {
  return prev.block === next.block && prev.blockKey === next.blockKey && prev.fileChangesMap === next.fileChangesMap && prev.allBlocks === next.allBlocks && prev.subGroupRenderers === next.subGroupRenderers;
});

// Token 徽标组件：鼠标 hover 时显示汇总详情 tooltip（问题 3 修复）。
// 通用数据源（tokens + history）：mainagent 消息头（TokenDisplay 复用）、
// subagent 组头、压缩气泡均使用，与 mainagent 回显详情完全同构。
// 汇总值全部通过 token_usage_history 各字段求和获得，每个字段独立一行；
// 下方调用详情只列次数/时间/finish_reason，不显示每次的具体 token。
// 注意：定义必须位于所有使用方（CompactionBubble / AgentGroupItem / CompactionMessageItem /
// TokenDisplay）之前，避免模块求值顺序引发的 ReferenceError（Vite HMR 已实测崩溃）。
// 后端聚合改造（4.5-1）：5 字段由后端聚合传入（totals），不再前端 reduce——
// 流式由 updateAgentTokens 写块级 agent_token_totals、回显由 build_flattened_blocks
// 注入 agent_token_totals / 消息级 token_usage，前端只负责显示。
const TokenBadge = ({ tokens, totals, history, style }: { tokens: number; totals?: TokenTotals; history?: any[]; style?: React.CSSProperties }) => {
  const [hovered, setHovered] = useState(false);

  const hist = history || [];
  const hasHistory = hist.length > 0;

  // 5 字段直接显示后端聚合值（totals），历史数据缺失时 0 填充
  const displayTotals = {
    system_prompt: totals?.system_prompt ?? 0,
    user_prompt: totals?.user_prompt ?? 0,
    assistant_prompt: totals?.assistant_prompt ?? 0,
    completion: totals?.completion ?? 0,
    total_token: totals?.total ?? 0,
  };

  const tokenLabel = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Text style={{ fontSize: 11, color: 'var(--text-400)', background: 'var(--bg-200)', padding: '0 6px', borderRadius: 4, cursor: hasHistory ? 'help' : 'default' }}>
        {tokenLabel} tokens
      </Text>
      {hovered && hasHistory && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            padding: 8,
            background: 'var(--bg-100)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--text-300)',
            border: '1px solid var(--border-100)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            lineHeight: 1.6,
            zIndex: 100,
            whiteSpace: 'nowrap',
            minWidth: 220,
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <div>system_prompt={displayTotals.system_prompt}</div>
            <div>user_prompt={displayTotals.user_prompt}</div>
            <div>assistant_prompt={displayTotals.assistant_prompt}</div>
            <div>completion={displayTotals.completion}</div>
            <div>total_token={displayTotals.total_token}</div>
          </div>
          <div style={{ fontWeight: 500, color: 'var(--text-200)', marginBottom: 4, borderTop: '1px solid var(--border-100)', paddingTop: 4 }}>
            调用详情（{hist.length} 次调用）
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {hist.map((entry, i) => (
              <div key={i} style={{ paddingLeft: 6, borderLeft: '2px solid var(--border-100)' }}>
                #{entry.iteration} · {entry.timestamp} · {entry.finish_reason} · {entry.duration_ms}ms
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
};

// 统一渲染（统一修复）：压缩气泡/压缩消息展开后的内容区。逐块复用标准渲染
// DataBlockItem —— reasoning_content → ThoughtBlock（可独立折叠，与正常轮次一致）、
// content/text → ContentBlock。消除"thought 平铺堆叠、不可折叠"的不统一形态。
const CompactionBlocks = ({ blocks, msgId, onToggle, blockKeyPrefix, fileChangesMap, onFileClick }: {
  blocks: DataBlock[];
  msgId: string;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKeyPrefix: string;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  onFileClick?: (filePath: string) => void;
}) => {
  return (
    <div style={{ marginTop: 8, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
      {blocks.map((block, bi) => (
        <div key={bi} style={{ marginBottom: bi < blocks.length - 1 ? 10 : 0 }}>
          <DataBlockItem
            block={block}
            idx={bi}
            msgId={msgId}
            onToggle={onToggle}
            blockKey={`${blockKeyPrefix}-inner-${bi}`}
            fileChangesMap={fileChangesMap}
            allBlocks={blocks}
            onFileClick={onFileClick}
          />
        </div>
      ))}
    </div>
  );
};

// 嵌套压缩气泡：subagent 层级内的压缩块组（同一压缩轮的 reasoning + content 连续块合并渲染），
// 样式与顶层 CompactionMessageItem 一致（左边框+背景+圆角、头部"上下文已压缩"+tokens+agent、
// 默认折叠、▸/▾ 点击展开）。展开后通过 CompactionBlocks 复用标准渲染：reasoning_content
// （ⓘ Thought，独立可折叠）与 content（摘要正文）——统一修复：压缩轮 thought 归入压缩气泡、
// 渲染形态与正常轮次完全一致（ThoughtBlock + ContentBlock）。
const CompactionBubble = React.memo(({ blocks, agentName, tokens, tokenHistory, tokenTotals, isExpanded, onToggle, blockKey, msgId, fileChangesMap, onFileClick }: {
  blocks: DataBlock[];
  agentName: string;
  tokens?: number | null;
  tokenHistory?: any[];
  tokenTotals?: TokenTotals;
  isExpanded: boolean;
  onToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  blockKey: string;
  msgId: string;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  onFileClick?: (filePath: string) => void;
}) => {
  const displayTokens = tokens || 0;

  return (
    <div
      data-message-role="compaction"
      style={{
        borderLeft: '3px solid var(--bg-300)',
        background: 'var(--bg-200)',
        borderRadius: 4,
        padding: '8px 12px',
        cursor: 'pointer',
        userSelect: 'none',
        marginTop: 8,
      }}
      onClick={() => onToggle(blocks[0], blockKey, isExpanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-300)', width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isExpanded ? '▾' : '▸'}
        </span>
        <Text style={{ fontSize: 12, color: 'var(--text-300)', fontWeight: 500 }}>上下文已压缩</Text>
        {displayTokens > 0 && (
          // 后端聚合改造（4.5-4）：压缩气泡 hover 显示本阶段聚合（块级 agent_token_totals，
          // 由 updateAgentTokens / build_flattened_blocks 注入；5 字段 = 本阶段，非整轮）
          <TokenBadge tokens={displayTokens} totals={tokenTotals} history={tokenHistory} />
        )}
        <Text style={{ fontSize: 11, color: 'var(--text-400)' }}>
          · {agentName}
        </Text>
      </div>
      {isExpanded && (
        <CompactionBlocks
          blocks={blocks}
          msgId={msgId}
          onToggle={onToggle}
          blockKeyPrefix={blockKey}
          fileChangesMap={fileChangesMap}
          onFileClick={onFileClick}
        />
      )}
    </div>
  );
}, (prev, next) => prev.blocks === next.blocks && prev.isExpanded === next.isExpanded && prev.blockKey === next.blockKey);

const AgentGroupItem = React.memo(({ group, msgId, allMessageBlocks, handleBlockToggle, fileChangesMap, onFileClick, subagentGroups = [] }: {
  group: AgentGroup;
  msgId: string;
  allMessageBlocks: DataBlock[];
  handleBlockToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  onFileClick?: (filePath: string) => void;
  /** 当前组的子 subagent 组（tc_id 分离：产生子执行的 tool_call 块后按 tc.id 精确匹配嵌套渲染） */
  subagentGroups?: AgentGroup[];
}) => {
  const isMainAgent = group.agent_level === 0;
  const borderColor = getSubagentColor(group.agent_level);
  const expandedBlockKeys = useRunPanelStore(state => state.expandedBlockKeys);

  // 合并渲染：连续相邻的 _is_compaction 块（同一压缩轮的 reasoning + text）合并为一个
  // CompactionBubble（问题 1 修复：压缩轮 thought 归入压缩气泡）。mainagent 与 subagent
  // 同一路径，保证所有 agent 完全一致。
  const blocks: React.ReactNode[] = [];
  let i = 0;
  // 已消费子组（跨块共享）：tc.id 分离——每个产生子执行的 tool_call 的 tc.id 由
  // agent_start source_tool_call_id（流式）/ task 消息持久化（回显）注入子组块的
  // source_tool_call_id，渲染时按 tc.id === 组.sourceToolCallId 精确匹配（顺序无关：
  // 并发事件到达顺序与工具调用顺序无关，无需游标顺序消费；与工具名无关，所有工具
  // 天然支持并发）。
  const consumedSubGroups = new Set<string>();
  const pendingSubGroups = () => subagentGroups.filter(g => !!g.instanceKey && !consumedSubGroups.has(g.instanceKey));
  while (i < group.blocks.length) {
    const block = group.blocks[i];
    if (block._is_compaction) {
      const compBlocks: DataBlock[] = [block];
      let j = i + 1;
      while (j < group.blocks.length && group.blocks[j]._is_compaction) {
        compBlocks.push(group.blocks[j]);
        j++;
      }
      const first = compBlocks[0];
      // 块 key 必须全局唯一：mainagent 与 subagent 组共享同一 msgId，组内索引 i 各自从 0 开始，
      // 若 key 只用 `${msgId}-${i}`，mainagent 与 subagent 同序块会互相冲突（展开/折叠联动）。
      // 因此前缀组实例唯一键 instanceKey（agent_id + message_id）。
      const compKey = `${msgId}-${group.instanceKey || 'root'}-${i}-comp`;
      blocks.push(
        <CompactionBubble
          key={compKey}
          blocks={compBlocks}
          agentName={first.agent_name || group.agent_name || 'AI助手'}
          tokens={first.agent_tokens}
          tokenHistory={first.agent_token_history}
          tokenTotals={first.agent_token_totals}
          isExpanded={expandedBlockKeys[compKey] ?? first._isExpanding ?? false}
          onToggle={handleBlockToggle}
          blockKey={compKey}
          msgId={msgId}
          fileChangesMap={fileChangesMap}
          onFileClick={onFileClick}
        />
      );
      i = j;
    } else {
      const blockKey = `${msgId}-${group.instanceKey || 'root'}-${i}`;
      // 通用子组消费（tc.id 对号，非工具名集合驱动）：所有工具调用都拥有唯一的
      // tool_call_id（tc.id，LLM 生成）。流式：子组块由 agent_start source_tool_call_id
      // 注入；回显：run_api 从 task 消息持久化的 source_tool_call_id 注入子组块——
      // 均按 tc.id === 组.sourceToolCallId 精确嵌套（出现即对号，无需等任何事件）。
      // 匹配到的子组作为"tc 插槽"随 tc 交错嵌套渲染（tc 徽标下即子组，
      // task → subagent → task → subagent），而非追加在 tool_calls 块后（会聚成
      // task task → subagent subagent）。
      let subGroupRenderers: Record<string, React.ReactNode> = {};
      if (block.type === 'tool_calls') {
        for (const tc of block.tool_calls || []) {
          const tcId = tc.id;
          let g: AgentGroup | undefined;
          if (tcId) {
            g = subagentGroups.find(x => !!x.instanceKey && x.sourceToolCallId && x.sourceToolCallId === tcId && !consumedSubGroups.has(x.instanceKey));
          }
          if (g) {
            consumedSubGroups.add(g.instanceKey!);
            subGroupRenderers[tcId] = (
              <AgentGroupItem
                group={g}
                msgId={msgId}
                allMessageBlocks={allMessageBlocks}
                handleBlockToggle={handleBlockToggle}
                fileChangesMap={fileChangesMap}
                onFileClick={onFileClick}
                subagentGroups={pendingSubGroups()}
              />
            );
          }
        }
      }
      blocks.push(
        <DataBlockItem
          key={i}
          block={block}
          idx={i}
          msgId={msgId}
          onToggle={handleBlockToggle}
          blockKey={blockKey}
          fileChangesMap={fileChangesMap}
          allBlocks={allMessageBlocks || group.blocks}
          onFileClick={onFileClick}
          subGroupRenderers={subGroupRenderers}
        />
      );
      i++;
    }
  }

  if (isMainAgent) {
    return <>{blocks}</>;
  }

  // 后端聚合改造（4.5-3）：组头 token 从 agentUsageMap 读该 subagent 的 agent 级整轮累计
  //（由 updateAgentTokens 写入：agent_token_usage 推送 agent_usage / agent_complete
  // metadata.agent_usage），前端不再 mergeTokenHistories(group.blocks) + sumHistoryTokens 拼接。
  const agentUsageMap = useRunPanelStore(state => state.agentUsageMap);
  // 〇·3 并发修复 + 回显隔离修复：组头只按组实例 message_id 精确查询 agentUsageMap。
  // 禁止回退到 agent_id 兜底——agent_id 键会被同 agent 的最新流式执行覆盖（setAgentUsage
  // 双键写入），回显的历史消息 subagent 组头会读到最新执行 token（跨消息混写）。
  // 流式实例：message_id 命中 agentUsageMap（各实例独立）；回显/未命中：
  // groupUsage=undefined，走后端注入的组级累计 group_agent_*。
  const groupUsage = group.message_id ? agentUsageMap[group.message_id] : undefined;
  // 回显路径（无 agentUsageMap，刷新后无流式事件重放）：组头走后端注入的组级整轮
  // 累计（group_agent_*：该 subagent 本次 task 调用全部消息 history 求和，与流式
  // agentUsageMap 同构）；块级 agent_tokens 为单消息（压缩气泡用），不用于组头。
  const groupTokenHistory = groupUsage?.history || group.group_agent_history || [];
  const groupTotalTokens = groupUsage?.tokens ?? group.group_agent_tokens ?? group.agent_tokens;
  const groupTotals = groupUsage?.totals ?? group.group_agent_totals;

  return (
    <div style={{
      marginLeft: 6 * group.agent_level,
      marginTop: 8,
      borderLeft: `3px solid ${borderColor}`,
      paddingLeft: 12,
      paddingTop: 6,
      background: 'rgba(63, 81, 181, 0.05)',
      borderRadius: 6,
      paddingBottom: 8,
    }}>
      <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 13, color: borderColor, fontWeight: 500 }}>
          {group.agent_name}
        </Text>
        {groupTotalTokens != null && groupTotalTokens > 0 && (
          // 问题 3 修复：组头 token 用 TokenBadge（hover 显示 system_prompt/user_prompt/
          // asst/completion/total + 调用详情），与 mainagent 消息头 TokenDisplay 同构。
          // 组头显示该 agent 全部调用累计（含压缩轮/resume，与 mainagent 语义一致）。
          // 后端聚合改造（4.5-3）：5 字段 = groupUsage.totals（后端 agent 级整轮聚合）
          <TokenBadge tokens={groupTotalTokens} totals={groupTotals} history={groupTokenHistory} />
        )}
      </div>
      {blocks}
    </div>
  );
}, (prev, next) => {
  return prev.group === next.group
    && prev.fileChangesMap === next.fileChangesMap
    && prev.allMessageBlocks === next.allMessageBlocks;
});

const extractAgentName = (msg: LLMMessage, canvasData?: any): string | null => {
  // 优先：实时从 canvas_data nodes 查询 agent_name（替代数据库存储的 agent_name 字段）
  if (canvasData && msg.agent_id) {
    const nodes = canvasData?.nodes || [];
    for (const node of nodes) {
      if (node.id === msg.agent_id) {
        const name = node?.data?.name;
        if (name) return name;
      }
    }
  }
  if (msg.agent_name) return msg.agent_name;
  for (const block of msg.data || []) {
    if (block.type === 'tool_calls') {
      for (const tc of block.tool_calls || []) {
        // 通用判断（非工具名集合）：产生子执行的 tc 其 result 被框架钩子覆盖为
        // {success, subagent_name, subagent_id, content}——据此提取子组名称；
        // 无 result（未执行/无子执行）的 tc 跳过（与工具名无关）。
        if (!tc.result) continue;
        try {
          const args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments;
          if (args?.subagent_name) return args.subagent_name;
        } catch {}
        try {
          const result = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
          if (result?.subagent_name) return result.subagent_name;
        } catch {}
      }
    }
  }
  return null;
};

const UserMessageItem = React.memo(({ msg, isHovered, onHover, onLeave, onRewind, onCancelPreview, onConfirmRecall, onFileClick, currentSessionId, onDelete }: {
  msg: LLMMessage;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onRewind: () => void;
  onCancelPreview: () => void;
  onConfirmRecall: () => void;
  onFileClick?: (filePath: string) => void;
  currentSessionId: string | null;
  onDelete: (deletedIds: string[]) => void;
}) => {
  const { message: antMessage } = App.useApp();
  const recallingMessageId = useRunPanelStore(state => state.recallingMessageId);
  const recallPreviewFiles = useRunPanelStore(state => state.recallPreviewFiles);
  const recallPreviewMessageId = useRunPanelStore(state => state.recallPreviewMessageId);
  const previewFiles = recallPreviewFiles[msg.id];
  const isPreviewing = recallPreviewMessageId === msg.id;

  const handleCopy = useCallback(() => {
    const ok = copyToClipboard(msg.content || '');
    if (ok) {
      antMessage.success('已复制到剪贴板');
    } else {
      antMessage.error('复制失败');
    }
  }, [msg.content, antMessage]);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeleteClick = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    try {
      const result = await fileChangesApi.deleteMessages({
        session_id: currentSessionId!,
        from_message_id: msg.id,
      });
      const data = (result as any)?.data || result;
      const deletedIds = data?.deleted_ids || [];
      onDelete(deletedIds);
      antMessage.success('消息已删除');
    } catch (err: any) {
      const status = err?.response?.status;
      const serverDetail = err?.response?.data?.detail || '';
      const errorMsg = serverDetail
        ? `删除失败: ${serverDetail} (HTTP ${status})`
        : `删除失败: ${err?.message || '未知错误'} (HTTP ${status || '?'})`;
      antMessage.error(errorMsg);
    }
  }, [antMessage, currentSessionId, msg.id, onDelete]);

  const isRecallDisabled = !!recallingMessageId || isPreviewing;

  const actionBtnStyle = useMemo((): React.CSSProperties => ({
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'var(--text-300)',
    transition: 'all 0.15s',
    border: 'none',
    background: 'transparent',
  }), []);

  return (
    <div data-message-role="user" onMouseEnter={onHover} onMouseLeave={onLeave} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row-reverse', height: 28 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontWeight: 500, fontSize: 12, lineHeight: '28px' }}>U</span>
        </div>
        <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500, lineHeight: '28px' }}>用户</Text>
        <Text style={{ fontSize: 12, color: 'var(--text-300)', opacity: isHovered ? 1 : 0, transition: 'opacity 0.2s', lineHeight: '28px' }}>
          {formatSmartTime(msg.timestamp)}
        </Text>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexDirection: 'row', maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, opacity: isHovered ? 1 : 0, transition: 'opacity 0.2s', flexShrink: 0, marginTop: 6 }}>
          <Tooltip title="复制">
            <button
              style={actionBtnStyle}
              onClick={(e) => { e.stopPropagation(); handleCopy(); }}
              className="sc-message-action-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </Tooltip>
          <Tooltip title="删除">
            <button
              style={actionBtnStyle}
              onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
              className="sc-message-action-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </Tooltip>
          <Tooltip title="撤回此次对话">
            <button
              style={{ ...actionBtnStyle, cursor: isRecallDisabled ? 'not-allowed' : 'pointer', opacity: isRecallDisabled ? 0.4 : 1 }}
              disabled={isRecallDisabled}
              onClick={(e) => { e.stopPropagation(); if (!isRecallDisabled) onRewind(); }}
              className="sc-message-action-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <path d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 0 1 0 12h-3"/>
              </svg>
            </button>
          </Tooltip>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-200)', maxWidth: '90%', minWidth: 0 }}>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', lineHeight: 1.7, fontSize: 14, color: 'var(--text-100)' }}>
            {msg.content}
          </div>
        </div>
      </div>
      {isPreviewing && (
        <div className="sc-recall-preview-panel">
          <div className="sc-recall-preview-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ExclamationCircleOutlined style={{ fontSize: 14, color: '#faad14' }} />
              <span className="sc-recall-preview-title">确定要回退至此次问答重新发起吗？</span>
            </div>
            <CloseOutlined className="sc-recall-preview-close" onClick={onCancelPreview} />
          </div>
          {previewFiles && previewFiles.length > 0 ? (
            <div className="sc-change-file-list">
              {previewFiles.map((previewFile: any) => {
                const fileName = previewFile.file_path.split(/[\\/]/).pop() || previewFile.file_path;
                const absPath = previewFile.absolute_path || previewFile.file_path;
                const actionMap: Record<string, { label: string; className: string }> = {
                  '删除': { label: '将被删除', className: 'deleted' },
                  '新建': { label: '将被新建', className: 'created' },
                  '修改': { label: '将被修改', className: 'modified' },
                };
                const action = actionMap[previewFile.recall_action] || { label: previewFile.recall_action, className: 'modified' };
                return (
                  <div key={previewFile.file_path} className="sc-change-file-item">
                    <span className="sc-change-file-icon">{getFileIcon(previewFile.file_path)}</span>
                    <span
                      className="sc-change-file-name"
                      onClick={() => onFileClick?.(previewFile.absolute_path || previewFile.file_path)}
                      title={`点击打开: ${previewFile.absolute_path || previewFile.file_path}`}
                    >{fileName}</span>
                    <span className="sc-change-file-dir">{absPath}</span>
                    <span className="sc-change-file-stats-right">
                      <span className={`sc-change-op-badge ${action.className}`}>{action.label}</span>
                      <span className="sc-change-file-stats">
                        <span className="added">+{previewFile.lines_removed || 0}</span>
                        <span className="removed">-{previewFile.lines_added || 0}</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sc-recall-preview-info-row">
              <InfoCircleOutlined style={{ fontSize: 14, color: 'var(--primary-100)' }} />
              <span>仅撤回对话消息，无文件变更</span>
            </div>
          )}
          <div className="sc-recall-preview-actions">
            <button className="sc-recall-cancel-btn" onClick={onCancelPreview}>取消</button>
            <button className="sc-recall-confirm-btn" disabled={!!recallingMessageId} onClick={onConfirmRecall}>
              {recallingMessageId && <LoadingOutlined spin />}
              <span>确认</span>
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="删除此消息"
        content="确定要删除此消息及其后续回复吗？此操作不可恢复，但不会影响已创建的文件。"
        okText="确认"
        cancelText="取消"
        danger
        onOk={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
}, (prev, next) => prev.msg === next.msg && prev.isHovered === next.isHovered);

// Token 显示组件（mainagent 消息头）：复用 TokenBadge，数据源 msg.tokens + token_totals（后端聚合）+ token_usage_history
const TokenDisplay = ({ msg, style }: { msg: LLMMessage; style?: React.CSSProperties }) => {
  if (msg.tokens == null || msg.tokens <= 0) return null;
  // 后端聚合改造（4.5-6）：5 字段 = msg.token_totals（回显由后端 token_usage 映射而来）
  return <TokenBadge tokens={msg.tokens} totals={msg.token_totals} history={msg.token_usage_history} style={style} />;
};

const AssistantMessageItem = React.memo(({ msg, msgIdx, messages, currentSessionId, currentProject, fileChangeRefreshKey, fileChangesMap, handleBlockToggle, onFileClick }: {
  msg: LLMMessage;
  msgIdx: number;
  messages: Message[];
  currentSessionId: string | null;
  currentProject: any;
  fileChangeRefreshKey: number;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  handleBlockToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  onFileClick?: (filePath: string) => void;
}) => {
  const canvasData = useRunPanelStore(state => state.canvasData);
  const agentGroups = useMemo(() => {
    return msg.data ? groupDataBlocksByAgent(msg.data) : [];
  }, [msg.data]);

  const getFileChangesForMessage = (msgId: string, blocks: DataBlock[] | undefined) => {
    const apiChanges = fileChangesMap[msgId]?.filter((fileChange: any) => !fileChange.tool_call_id);
    if (apiChanges && apiChanges.length > 0) return apiChanges;
    if (!blocks) return null;
    return blocks.filter(b => b.type === 'file_changes' && !b.file_changes?.some((fileChange: any) => fileChange._preview)).flatMap(b => b.file_changes || []);
  };

  // 所有 assistant 消息都显示 LLM 回复块（AI 头像/名称/时间/tokens）
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>
              {extractAgentName(msg, canvasData) || 'AI助手'}
            </Text>
            {msg.isCompaction && (
              <span style={{
                fontSize: 11,
                color: '#8a6d1d',
                background: 'rgba(250, 219, 20, 0.12)',
                border: '1px solid rgba(250, 219, 20, 0.35)',
                borderRadius: 4,
                padding: '0 6px',
                lineHeight: '18px',
              }}>
                上下文已压缩
              </span>
            )}
            <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>
              {formatSmartTime(msg.timestamp)}
            </Text>
            <TokenDisplay msg={msg} />
          </div>
          {msg.data && (() => {
            if (agentGroups.length === 0) return null;
            const mainGroup = agentGroups.find(g => g.agent_level === 0);
            const subGroups = agentGroups.filter(g => g.agent_level > 0);
            if (mainGroup) {
              // mainagent 组渲染时传入 subagent 组：AgentGroupItem 在产生子执行的
              // tool_call 块后按 tc.id 精确匹配插入嵌套渲染（与工具名无关）。
              return (
                <AgentGroupItem
                  key="main"
                  group={mainGroup}
                  msgId={msg.id}
                  allMessageBlocks={msg.data!}
                  handleBlockToggle={handleBlockToggle}
                  fileChangesMap={fileChangesMap}
                  onFileClick={onFileClick}
                  subagentGroups={subGroups}
                />
              );
            }
            // 无 mainagent 组（异常数据）：直接渲染全部组（subagent 独立组头）
            return agentGroups.map((group, groupIdx) => (
              <AgentGroupItem
                key={groupIdx}
                group={group}
                msgId={msg.id}
                allMessageBlocks={msg.data!}
                handleBlockToggle={handleBlockToggle}
                fileChangesMap={fileChangesMap}
                onFileClick={onFileClick}
              />
            ));
          })()}
          {currentSessionId && (msg.status === 'completed' || msg.status === 'error' || msg.status === 'stop' || msg.status === 'stopped') && (
            <FileChangePanel
              sessionId={currentSessionId}
              messageId={msg.id}
              subsequentMessageIds={messages.filter((m, i) => i > msgIdx && m.role === 'assistant').map(m => m.id)}
              refreshKey={fileChangeRefreshKey}
              workingDir={currentProject?.folder_path}
              initialChanges={getFileChangesForMessage(msg.id, msg.data)}
              onFileClick={onFileClick}
            />
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.msg === next.msg
    && prev.msgIdx === next.msgIdx
    && prev.messages === next.messages
    && prev.currentSessionId === next.currentSessionId
    && prev.currentProject === next.currentProject
    && prev.fileChangeRefreshKey === next.fileChangeRefreshKey
    && prev.fileChangesMap === next.fileChangesMap
    && prev.handleBlockToggle === next.handleBlockToggle;
});

// 压缩轮次独立气泡（恢复 v0.3.0.2-alpha 效果）：status==='compacted' 的摘要消息
// 渲染为独立压缩气泡——data-message-role="compaction"、左边框+背景+圆角、
// 头部"上下文已压缩"+时间+tokens+agent、默认折叠、▸/▾ 点击展开摘要正文。
const CompactionMessageItem = React.memo(({ msg, msgIdx, messages, currentSessionId, currentProject, fileChangeRefreshKey, fileChangesMap, handleBlockToggle, onFileClick }: {
  msg: LLMMessage;
  msgIdx: number;
  messages: Message[];
  currentSessionId: string | null;
  currentProject: any;
  fileChangeRefreshKey: number;
  fileChangesMap: Record<string, FileChangeInfo[]>;
  handleBlockToggle: (block: DataBlock, blockKey: string, currentIsExpanding: boolean) => void;
  onFileClick?: (filePath: string) => void;
}) => {
  const canvasData = useRunPanelStore(state => state.canvasData);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const agentName = extractAgentName(msg, canvasData) || 'AI助手';

  return (
    <div
      data-message-role="compaction"
      style={{
        borderLeft: '3px solid var(--bg-300)',
        background: 'var(--bg-200)',
        borderRadius: 4,
        padding: '8px 12px',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => setIsCollapsed(prev => !prev)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-300)', width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isCollapsed ? '▸' : '▾'}
        </span>
        <Text style={{ fontSize: 12, color: 'var(--text-300)', fontWeight: 500 }}>上下文已压缩</Text>
        <Text style={{ fontSize: 11, color: 'var(--text-400)' }}>
          {formatSmartTime(msg.timestamp)}
        </Text>
        {msg.tokens != null && msg.tokens > 0 && (
          // 问题 3 修复：独立压缩消息 token 用 TokenBadge（hover 详情与 mainagent 同构）
          // 后端聚合改造（4.5-5）：5 字段 = msg.token_totals（后端 token_usage 映射）
          <TokenBadge tokens={msg.tokens} totals={msg.token_totals} history={msg.token_usage_history} />
        )}
        <Text style={{ fontSize: 11, color: 'var(--text-400)' }}>
          · {agentName}
        </Text>
      </div>
      {!isCollapsed && (
        // 统一修复：展开区直接复用 CompactionBlocks（标准渲染：ThoughtBlock 可折叠 +
        // ContentBlock 摘要），不再经 AgentGroupItem —— 消除"外层气泡 + 内层气泡"双层嵌套。
        <CompactionBlocks
          blocks={msg.data || []}
          msgId={msg.id}
          onToggle={handleBlockToggle}
          blockKeyPrefix={`compmsg-${msg.id}`}
          fileChangesMap={fileChangesMap}
          onFileClick={onFileClick}
        />
      )}
    </div>
  );
}, (prev, next) => {
  return prev.msg === next.msg
    && prev.msgIdx === next.msgIdx
    && prev.messages === next.messages
    && prev.currentSessionId === next.currentSessionId
    && prev.currentProject === next.currentProject
    && prev.fileChangeRefreshKey === next.fileChangeRefreshKey
    && prev.fileChangesMap === next.fileChangesMap
    && prev.handleBlockToggle === next.handleBlockToggle;
});

const SystemMessageItem = React.memo(({ msg }: { msg: SystemMessage }) => {
  return (
    <div style={{
      padding: '8px 12px',
      background: 'rgba(255, 77, 79, 0.08)',
      borderLeft: '3px solid #ff4d4f',
      borderRadius: 4,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
    }}>
      <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 14, marginTop: 2, flexShrink: 0 }} />
      <Text style={{ fontSize: 13, color: '#ff4d4f', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', lineHeight: 1.6 }}>
        {msg.error}
      </Text>
    </div>
  );
}, (prev, next) => prev.msg === next.msg);

export interface MessageListHandle {
  isAutoScrollEnabled: boolean;
  scrollToBottom: () => void;
  disableAutoScroll: () => void;
}

interface MessageListProps {
  isWaitingReply: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  onFileClick?: (filePath: string) => void;
}

const MessageList = forwardRef<MessageListHandle, MessageListProps>(({ isWaitingReply, scrollContainerRef, onFileClick }, ref) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useRunPanelStore(state => state.messages);
  const streamingData = useRunPanelStore(state => state.streamingData);
  const toggleBlockExpand = useRunPanelStore(state => state.toggleBlockExpand);
  const hoveredMessageId = useRunPanelStore(state => state.hoveredMessageId);
  const setHoveredMessageId = useRunPanelStore(state => state.setHoveredMessageId);
  const currentSessionId = useRunPanelStore(state => state.currentSessionId);
  const currentProject = useRunPanelStore(state => state.currentProject);
  const recallingMessageId = useRunPanelStore(state => state.recallingMessageId);
  const setMessages = useRunPanelStore(state => state.setMessages);
  const setRecallingMessageId = useRunPanelStore(state => state.setRecallingMessageId);
  const setRecallPreviewFiles = useRunPanelStore(state => state.setRecallPreviewFiles);
  const clearRecallPreview = useRunPanelStore(state => state.clearRecallPreview);
  const recallPreviewMessageId = useRunPanelStore(state => state.recallPreviewMessageId);
  const setInputText = useRunPanelStore(state => state.setInputText);
  const fileChangeRefreshKey = useRunPanelStore(state => state.fileChangeRefreshKey);
  const incrementFileChangeRefreshKey = useRunPanelStore(state => state.incrementFileChangeRefreshKey);
  const fileChangesMap = useRunPanelStore(state => state.fileChangesMap);

  const { message: antMessage } = App.useApp();

  const { isAutoScrollEnabled, scrollToBottom, disableAutoScroll, resetAutoScroll, performAutoScroll, performAutoScrollIntoView } = useAutoScroll({
    containerRef: scrollContainerRef,
    bottomThreshold: 64,
  });

  useImperativeHandle(ref, () => ({
    isAutoScrollEnabled,
    scrollToBottom,
    disableAutoScroll,
  }), [isAutoScrollEnabled, scrollToBottom, disableAutoScroll]);

  useEffect(() => {
    resetAutoScroll();
  }, [currentSessionId, resetAutoScroll]);

  const handleBlockToggle = useCallback((block: DataBlock, blockKey: string, currentIsExpanding: boolean) => {
    block._userToggled = true;
    toggleBlockExpand(blockKey, currentIsExpanding);
  }, [toggleBlockExpand]);

  const scrollRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      performAutoScroll();
      scrollRafRef.current = null;
    });
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, [streamingData, performAutoScroll]);

  useEffect(() => {
    performAutoScrollIntoView(messagesEndRef.current);
  }, [messages, performAutoScrollIntoView]);

  const streamingGroups = useMemo(() => {
    return groupDataBlocksByAgent(streamingData);
  }, [streamingData]);

  // 后端聚合改造（4.5-2）：流式消息头 mainagent（root）级 token 从 agentUsageMap 读
  // agent 级整轮累计（由 updateAgentTokens 写入：agent_token_usage 推送 agent_usage /
  // agent_complete metadata.agent_usage）。前端不再 mergeTokenHistories(finalData/
  // streamingData.filter(agent_level===0)) + sumHistoryTokens 拼接——整轮 total/history
  // 由后端 _agent_accumulated_usage 聚合，与回显消息头（TokenDisplay token_usage/tokens）
  // 完全同构。
  const agentUsageMap = useRunPanelStore(state => state.agentUsageMap);
  const streamingMainToken = useMemo(() => {
    // root agent id 与 streamingGroups 首个 mainagent 组一致（agent_level===0）；
    // 流式消息头只显示 mainagent（root）的整轮 token
    const rootGroup = streamingGroups.find(g => g.agent_level === 0);
    const u = rootGroup?.agent_id ? agentUsageMap[rootGroup.agent_id] : undefined;
    return { tokens: u?.tokens, totals: u?.totals, history: u?.history || [] };
  }, [streamingGroups, agentUsageMap]);

  const handlePreviewRecall = useCallback(async (msg: LLMMessage) => {
    if (!currentSessionId || recallingMessageId || recallPreviewMessageId) return;

    try {
      const result = await fileChangesApi.previewRewind({
        session_id: currentSessionId,
        from_message_id: msg.id,
      });
      const data = (result as any)?.data || result;
      const files = data?.files || [];

      setRecallPreviewFiles(msg.id, files);
    } catch (err: any) {
      clearRecallPreview();
      const status = err?.response?.status;
      const serverDetail = err?.response?.data?.detail || '';
      console.error('[Recall Preview] Error:', { status, serverDetail, sessionId: currentSessionId, fromMessageId: msg.id });
      const errorMsg = serverDetail
        ? `撤回预览失败: ${serverDetail} (HTTP ${status})`
        : `撤回预览失败: ${err?.message || '未知错误'} (HTTP ${status || '?'})`;
      antMessage.error(errorMsg);
    }
  }, [currentSessionId, recallingMessageId, recallPreviewMessageId, setRecallPreviewFiles, clearRecallPreview, antMessage]);

  const handleConfirmRecall = useCallback(async (msg: LLMMessage) => {
    if (!currentSessionId || recallingMessageId) return;

    setRecallingMessageId(msg.id);
    try {
      const result = await fileChangesApi.rewindMessages({
        session_id: currentSessionId,
        from_message_id: msg.id,
      });
      const data = (result as any)?.data || result;

      const targetIndex = messages.findIndex(m => m.id === msg.id);
      const recalledIds = messages.slice(targetIndex).map(m => m.id);
      setMessages(prev => prev.filter(m => !recalledIds.includes(m.id)));

      setInputText(msg.content || '');

      incrementFileChangeRefreshKey();
      clearRecallPreview();
      antMessage.success('撤回成功');
    } catch (err: any) {
      clearRecallPreview();
      const status = err?.response?.status;
      const serverDetail = err?.response?.data?.detail || '';
      console.error('[Recall] Error details:', { status, serverDetail, sessionId: currentSessionId, fromMessageId: msg.id, rawError: err });
      const errorMsg = serverDetail
        ? `撤回失败: ${serverDetail} (HTTP ${status})`
        : `撤回失败: ${err?.message || '未知错误'} (HTTP ${status || '?'})`;
      antMessage.error(errorMsg);
    } finally {
      setRecallingMessageId(null);
    }
  }, [currentSessionId, recallingMessageId, setRecallingMessageId, messages, setMessages, setInputText, incrementFileChangeRefreshKey, clearRecallPreview, antMessage]);

  const handleCancelRecall = useCallback(() => {
    clearRecallPreview();
  }, [clearRecallPreview]);

  return (
    <>
      {messages.length === 0 && streamingData.length === 0 && !isWaitingReply ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '40px 16px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, boxShadow: '0 8px 24px rgba(63, 81, 181, 0.25)' }}>
            <RobotOutlined style={{ fontSize: 24, color: '#fff' }} />
          </div>
          <Text style={{ fontSize: 16, color: 'var(--text-100)', fontWeight: 600, marginBottom: 8 }}>开始新对话</Text>
          <Text style={{ fontSize: 13, color: 'var(--text-300)', textAlign: 'center', lineHeight: 1.6 }}>在下方输入您的问题</Text>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {messages.map((msg, msgIdx) => {
            if (msg.role === 'user') {
              return (
                <UserMessageItem
                  key={msg.id}
                  msg={msg}
                  isHovered={hoveredMessageId === msg.id}
                  onHover={() => setHoveredMessageId(msg.id)}
                  onLeave={() => setHoveredMessageId(null)}
                  onRewind={() => {
                    handlePreviewRecall(msg);
                  }}
                  onCancelPreview={handleCancelRecall}
                  onConfirmRecall={() => {
                    handleConfirmRecall(msg);
                  }}
                  onFileClick={onFileClick}
                  currentSessionId={currentSessionId}
                  onDelete={(deletedIds) => {
                    setMessages(prev => prev.filter(m => !deletedIds.includes(m.id)));
                  }}
                />
              );
            }
            if (msg.role === 'error') {
              return (
                <div key={msg.id} style={{ marginTop: -12 }}>
                  <SystemMessageItem msg={msg} />
                </div>
              );
            }
            if (msg.isCompaction) {
              return (
                <CompactionMessageItem
                  key={msg.id}
                  msg={msg}
                  msgIdx={msgIdx}
                  messages={messages}
                  currentSessionId={currentSessionId}
                  currentProject={currentProject}
                  fileChangeRefreshKey={fileChangeRefreshKey}
                  fileChangesMap={fileChangesMap}
                  handleBlockToggle={handleBlockToggle}
                  onFileClick={onFileClick}
                />
              );
            }
            return (
              <AssistantMessageItem
                key={msg.id}
                msg={msg}
                msgIdx={msgIdx}
                messages={messages}
                currentSessionId={currentSessionId}
                currentProject={currentProject}
                fileChangeRefreshKey={fileChangeRefreshKey}
                fileChangesMap={fileChangesMap}
                handleBlockToggle={handleBlockToggle}
                onFileClick={onFileClick}
              />
            );
          })}

          {(isWaitingReply || streamingData.length > 0) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>
                    {streamingGroups[0]?.agent_name || 'AI助手'}
                  </Text>
                  <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatSmartTime(new Date().toISOString())}</Text>
                  {/* 问题 1 修复：流式消息头 mainagent token 详情（流式过程中实时可见）。
                      数据源 streamingMainToken 由后端 agent_token_usage 推送 agent_usage 实时更新
                      （后端聚合改造 4.5-2），与回显消息头（TokenDisplay）、subagent 组头
                      （AgentGroupItem）同一 TokenBadge。 */}
                  {streamingMainToken.tokens != null && streamingMainToken.tokens > 0 && (
                    <TokenBadge tokens={streamingMainToken.tokens} totals={streamingMainToken.totals} history={streamingMainToken.history} />
                  )}
                </div>
                {isWaitingReply && streamingData.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 14, height: 14, border: '2px solid var(--bg-300)', borderTopColor: 'var(--primary-100)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <Text style={{ fontSize: 14, color: 'var(--text-200)' }}>正在思考...</Text>
                  </div>
                )}
                {(() => {
                  if (streamingGroups.length === 0) return null;
                  const streamMainGroup = streamingGroups.find(g => g.agent_level === 0);
                  const streamSubGroups = streamingGroups.filter(g => g.agent_level > 0);
                  if (streamMainGroup) {
                    // 与回显同构：mainagent 组渲染时传入 subagent 组（产生子执行的 tool_call 后嵌套插入）
                    return (
                      <AgentGroupItem
                        key="stream-main"
                        group={streamMainGroup}
                        msgId="streaming"
                        allMessageBlocks={streamingData}
                        handleBlockToggle={handleBlockToggle}
                        fileChangesMap={fileChangesMap}
                        subagentGroups={streamSubGroups}
                      />
                    );
                  }
                  return streamingGroups.map((group, groupIdx) => (
                    <AgentGroupItem
                      key={groupIdx}
                      group={group}
                      msgId="streaming"
                      allMessageBlocks={streamingData}
                      handleBlockToggle={handleBlockToggle}
                      fileChangesMap={fileChangesMap}
                    />
                  ));
                })()}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}
    </>
  );
});

export default MessageList;
