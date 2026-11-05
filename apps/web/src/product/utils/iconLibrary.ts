/**
 * 画布图标库：内置的可选字形 + 检索关键词。
 *
 * 值是字形本身（emoji / 符号），与画布 `icon` 字段、列表字形（取首字）同源；
 * 关键词用于选择器搜索，中英都写，避免用户必须先知道 emoji 的官方名称。
 *
 * @module product/utils/iconLibrary
 */

/** 一个可选图标。 */
export interface IconOption {
  /** 落库值（字形本身）。 */
  glyph: string
  /** 检索关键词（中文与英文，空格分隔）。 */
  keywords: string
}

/** 内置图标集（按用途分组排列，去重）。 */
export const ICON_LIBRARY: readonly IconOption[] = [
  { glyph: '🤖', keywords: '机器人 agent 智能 robot bot' },
  { glyph: '🧠', keywords: '大脑 思考 智能 brain 推理' },
  { glyph: '💡', keywords: '灯泡 想法 创意 idea light' },
  { glyph: '✨', keywords: '闪光 生成 魔法 sparkle magic' },
  { glyph: '🚀', keywords: '火箭 发布 上线 rocket launch' },
  { glyph: '🎯', keywords: '目标 靶心 target goal' },
  { glyph: '📝', keywords: '笔记 写作 文档 memo write' },
  { glyph: '📄', keywords: '文档 页面 document page' },
  { glyph: '📚', keywords: '书 知识 学习 book learn' },
  { glyph: '📖', keywords: '阅读 手册 read book' },
  { glyph: '📊', keywords: '图表 统计 数据 chart data' },
  { glyph: '📈', keywords: '增长 趋势 上升 chart growth' },
  { glyph: '📉', keywords: '下降 趋势 chart down' },
  { glyph: '📋', keywords: '清单 任务 剪贴板 list task clipboard' },
  { glyph: '📌', keywords: '固定 图钉 pin' },
  { glyph: '🔍', keywords: '搜索 查找 search find' },
  { glyph: '🔎', keywords: '放大 检索 search zoom' },
  { glyph: '💻', keywords: '电脑 开发 代码 laptop code' },
  { glyph: '🖥️', keywords: '显示器 桌面 desktop monitor' },
  { glyph: '⌨️', keywords: '键盘 输入 keyboard' },
  { glyph: '💾', keywords: '保存 磁盘 save disk' },
  { glyph: '📁', keywords: '文件夹 目录 folder' },
  { glyph: '🗂️', keywords: '归档 分类 archive' },
  { glyph: '🔄', keywords: '循环 刷新 同步 loop sync refresh' },
  { glyph: '⚡', keywords: '闪电 快速 性能 bolt fast' },
  { glyph: '🌟', keywords: '星 亮点 star' },
  { glyph: '🎨', keywords: '设计 调色 艺术 design art' },
  { glyph: '🎭', keywords: '角色 表演 戏剧 role theater' },
  { glyph: '🎬', keywords: '视频 拍摄 剪辑 video film' },
  { glyph: '🔧', keywords: '工具 扳手 修复 tool fix wrench' },
  { glyph: '🛠️', keywords: '工具 组装 tools build' },
  { glyph: '⚙️', keywords: '设置 齿轮 配置 settings gear' },
  { glyph: '🔩', keywords: '零件 螺丝 组装 bolt' },
  { glyph: '🛡️', keywords: '安全 防护 盾牌 security shield' },
  { glyph: '🔐', keywords: '密钥 加密 安全 key lock secure' },
  { glyph: '🔑', keywords: '钥匙 权限 key access' },
  { glyph: '🔒', keywords: '锁定 只读 lock' },
  { glyph: '🚦', keywords: '红绿灯 状态 门禁 traffic status gate' },
  { glyph: '🧪', keywords: '实验 测试 试管 test experiment' },
  { glyph: '🧭', keywords: '导航 指南针 方向 compass' },
  { glyph: '🗺️', keywords: '地图 规划 map plan' },
  { glyph: '🏗️', keywords: '搭建 构造 工程 build construct' },
  { glyph: '🏢', keywords: '公司 组织 实例 org instance' },
  { glyph: '🏠', keywords: '首页 家 home' },
  { glyph: '👤', keywords: '用户 个人 user person' },
  { glyph: '👥', keywords: '用户 团队 多人 users team' },
  { glyph: '🎓', keywords: '学习 教育 毕业 learn education' },
  { glyph: '📐', keywords: '设计 尺寸 规范 design spec' },
  { glyph: '📏', keywords: '度量 尺寸 measure' },
  { glyph: '✏️', keywords: '编辑 铅笔 edit pencil' },
  { glyph: '🖊️', keywords: '钢笔 写作 pen write' },
  { glyph: '🎵', keywords: '音乐 音频 music audio' },
  { glyph: '🎧', keywords: '耳机 音频 audio' },
  { glyph: '🏆', keywords: '奖杯 完成 冠军 trophy done' },
  { glyph: '🏅', keywords: '奖牌 成就 medal' },
  { glyph: '🎮', keywords: '游戏 交互 game' },
  { glyph: '🎲', keywords: '随机 骰子 random dice' },
  { glyph: '🔮', keywords: '预测 水晶球 predict' },
  { glyph: '❤️', keywords: '喜欢 心 heart like' },
  { glyph: '💬', keywords: '对话 消息 聊天 chat message' },
  { glyph: '🗣️', keywords: '发言 语音 speak' },
  { glyph: '📢', keywords: '公告 广播 announce' },
  { glyph: '📦', keywords: '打包 制品 包 package artifact' },
  { glyph: '🧩', keywords: '插件 拼图 plugin' },
  { glyph: '🔌', keywords: '插件 接入 接口 plug adapter' },
  { glyph: '🌐', keywords: '网络 全球 web globe' },
  { glyph: '☁️', keywords: '云 云平台 cloud' },
  { glyph: '🗄️', keywords: '数据库 存储 database storage' },
  { glyph: '🗃️', keywords: '归档 数据 data archive' },
  { glyph: '⏱️', keywords: '计时 耗时 timer' },
  { glyph: '📅', keywords: '日历 计划 calendar schedule' },
  { glyph: '🔔', keywords: '提醒 通知 bell notify' },
  { glyph: '🚧', keywords: '施工 进行中 wip' },
  { glyph: '🧱', keywords: '积木 基础 block' },
  { glyph: '🪄', keywords: '魔法 自动 magic auto' },
  { glyph: '🛰️', keywords: '卫星 部署 satellite deploy' },
  { glyph: '🧬', keywords: '分支 演化 branch evolve' },
  { glyph: '🔗', keywords: '链接 关联 link' },
  { glyph: '📎', keywords: '附件 关联 attach' },
  { glyph: '🏷️', keywords: '标签 tag label' },
  { glyph: '🎫', keywords: '凭证 工单 ticket' },
  { glyph: '📡', keywords: '信号 事件 广播 signal event' },
  { glyph: '🕹️', keywords: '控制 操作 control' },
  { glyph: '🧰', keywords: '工具箱 能力 toolbox' },
  { glyph: '🗒️', keywords: '便签 笔记 note memo' },
  { glyph: '📘', keywords: '手册 文档 docs' },
  { glyph: '📗', keywords: '指南 文档 docs' },
  { glyph: '📙', keywords: '参考 文档 docs' },
  { glyph: '🔖', keywords: '书签 标记 bookmark' },
  { glyph: '✅', keywords: '完成 通过 check done' },
  { glyph: '❌', keywords: '失败 错误 fail error' },
  { glyph: '⚠️', keywords: '警告 注意 warn' },
  { glyph: '❓', keywords: '问题 帮助 question help' },
  { glyph: '⏳', keywords: '等待 处理中 pending wait' },
  { glyph: '♻️', keywords: '复用 循环 reuse recycle' },
]

/** 默认图标（未选择时展示）。 */
export const DEFAULT_CANVAS_ICON = '🤖'

/**
 * 按关键词过滤图标。
 * @param query - 搜索词（空串返回全量）。
 * @returns 匹配的图标；空串同样匹配。
 */
export function filterIcons(query: string): readonly IconOption[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return ICON_LIBRARY
  return ICON_LIBRARY.filter(option =>
    option.glyph === needle || option.keywords.toLowerCase().includes(needle))
}
