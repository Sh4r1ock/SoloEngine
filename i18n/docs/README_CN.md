<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="500"/>

</div>

---

<h3 align="center"><b>让 AI 驱动每一个行业。</b></h3>

---

**SoloEngine** 是第一款低代码 Agentic AI 开发平台。你只需像组建一支创业团队那样：将所需的 Agent 拖入画布，连接协作关系，点击编译——此后的规划、执行与交付，全部由 Agent 自主完成。
No Workflow. No orchestration code. Just Agents that get things done.

<div align="center">

[![Stars](https://img.shields.io/github/stars/Sh4r1ock/SoloEngine?style=flat-square&label=stars&color=FB6A76)](https://github.com/Sh4r1ock/SoloEngine)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)

</div>

[English](../../README.md) | 简体中文 | [Español](./README_ES.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

---

## 为什么选择 SoloEngine

Agentic AI 正在重塑软件开发的格局——一名开发者如今能完成过去需要十人团队才能交付的工作量。然而，这场变革始终被局限在代码编辑器之内。要构建一个真正意义上的 AI Agent，你不得不手写 LangChain 管线、反复调试 ReAct 循环、逐一定义工具 Schema。不懂编程？这一切便无从谈起。

现有的替代方案同样难以解决问题：工作流平台（Dify、n8n 等）执行的是预先编排的固定路径，其核心并非自主 Agent；代码框架（LangChain、CrewAI 等）则要求使用者必须具备 Python 编程能力。**SoloEngine** 的定位，正是填补这两者之间的空白。

| | Dify、n8n、Zapier | LangChain、CrewAI、LangGraph | **SoloEngine** |
|---|---|---|---|
| Agentic AI | ✗ 仅支持脚本化工作流 | ✓ ReAct / 多 Agent | ✓ ReAct / 多 Agent |
| 无需编码 | ✓ | ✗ 必须掌握 Python | ✓ |
| 可视化编排 | 部分支持 | ✗ | ✓ 完整的画布体验 |
| 领域专家可独立构建 | ✓（但 Agent 并非真正 Agentic） | ✗ | ✓ |
| 多 Agent 协作 | ✗ | ✓ | ✓ |

- **并非又一个工作流工具** —— Agent 的实际运行模式是「思考 → 行动 → 观察 → 重复」循环。所有决策都在运行时动态做出。当研究 Agent 遇到无法推进的情况，它会自动调整规划——不存在任何硬编码的兜底路径。
- **领域专家可直接构建** —— 律师将合同审查 Agent 拖入画布，连接到研究 Agent，点击编译。全程无需程序员介入。
- **工具、Skill、MCP——均可插拔** —— 每个 Agent 在运行时按需加载所需的工具和 Skill。得益于渐进式披露机制，Token 消耗可降低 85% 以上。
- **一个适配层，覆盖所有模型** —— OpenAI、Anthropic、Ollama、DeepSeek、通义千问、智谱——统一接口，无缝切换。

### 工作原理

所有 Agent 共享同一套底层原语，区别仅在于配置方式的不同。画布上的可视化设计经过编译，直接转化为可执行的 Agent 团队。

1. **编译** —— 可视化布局经拓扑排序转化为 Agent 有向无环图（DAG）。同一套编译器，可生成无数种团队组合。
2. **统一的 ReAct 引擎** —— 每个 Agent 均运行相同的「思考 → 行动 → 观察 → 重复」循环。
3. **渐进式披露** —— Agent 仅在运行时加载实际需要的内容，这让低代码环境下的 Agentic AI 变得切实可行。

## 快速开始

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine

# 后端 (Python 3.11+)
cd backend
pip install -r requirements.txt
python main.py

# 前端 (Node.js 18+) —— 在另一个终端中执行
cd frontend 
npm install
npm run dev
```

在浏览器中打开 **http://localhost:8991**，即可构建你的第一个 Agent 团队。

## 应用场景

- **VibeLawing** —— 律师将搜索 Agent、归档 Agent、排版 Agent 依次拖入画布，点击编译。法律工作随即自动运行起来：法条被定位、案例被整理、文档被格式化——整个过程就像开发者在 Cursor 中进行 vibe coding 一样自然流畅。
- **VibeMarketing** —— 营销人员将调研 Agent、文案 Agent、素材 Agent 拖入画布，点击编译。营销方案自动生成，受众分析自主完成。
- **一键打包** —— 搭建好 Agent 团队后，点击一键打包，即可输出一个可供任何人直接使用的完整产品。

## Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=Sh4r1ock/SoloEngine&type=Date)](https://star-history.com/#Sh4r1ock/SoloEngine&Date)

⭐ **如果你觉得 SoloEngine 有用，欢迎给我们点亮 Star——每一颗都是对我们莫大的鼓励！**

## 致谢

特别感谢：

<p align="center">
  <a href="https://github.com/XiaomiMiMo"><img src="https://avatars.githubusercontent.com/u/208276378?v=4" alt="MiMo" height="40"/></a>
</p>

## 参与贡献

我们非常期待你的加入。

无论是一个拼写修正、一个新工具插件、一处文档优化，还是一个完整的功能特性——每一点贡献都在让 SoloEngine 变得更好。无论 PR 大小，我们都同样欢迎。

📝 [贡献指南](../../CONTRIBUTING.md) &nbsp;·&nbsp; 🐛 [适合上手的问题](https://github.com/Sh4r1ock/SoloEngine/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) &nbsp;·&nbsp; 📧 [sh4r1ock@qq.com](mailto:sh4r1ock@qq.com)

## 许可证

Apache License 2.0。详见 [LICENSE](../../LICENSE)。

---

<div align="center">

**SoloEngine 团队，用 ❤️ 倾心打造**

</div>