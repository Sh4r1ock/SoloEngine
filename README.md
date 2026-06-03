<div align="center">

<img src="icon/SoloEngine.png" alt="SoloEngine" width="420"/>

</div>

***

<h2 align="center"><b>Let AI Run Every Industry.</b></h2>

***

<p align="center"><b>SoloEngine</b> is the first low-code platform that runs Agentic AI. Staff a team of Agents like a startup — drag them onto the canvas, connect the org chart, run — they plan, act, and deliver on their own.</p>
<p align="center">No Workflow. No orchestration code. Just Agents that get things done.</p>

<div align="center">

[![Stars](https://img.shields.io/github/stars/Sh4r1ock/SoloEngine?style=flat-square\&label=stars\&color=FB6A76)](https://github.com/Sh4r1ock/SoloEngine)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square\&logo=python\&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square\&logo=fastapi\&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square\&logo=react\&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square\&logo=typescript\&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)
[![Ask Zread](https://img.shields.io/badge/Zread-Ask_Zread-00b0aa?style=flat-square)](https://zread.ai/Sh4r1ock/SoloEngine)

</div>

<p align="center">
  English |
  <a href="i18n/readme/README_ZH.md">简体中文</a> |
  <a href="i18n/readme/README_ES.md">Español</a> |
  <a href="i18n/readme/README_DE.md">Deutsch</a> |
  <a href="i18n/readme/README_FR.md">Français</a>
</p>

***

## Why SoloEngine

Agentic AI is transforming software — one developer now ships the work of ten. But that revolution never left the IDE. Building real AI Agents means writing LangChain pipelines, debugging ReAct loops, and hand-authoring tool schemas. If you can't code, you're locked out.

The alternatives don't help: workflow platforms (Dify, n8n, etc.) run pre-scripted paths, not autonomous agents. Code frameworks (LangChain, CrewAI, etc.) require Python. **SoloEngine** fills the gap.

<div align="center">

|             <br />            |     Dify, n8n, Zapier     | LangChain, CrewAI, LangGraph |     **SoloEngine**    |
| :---------------------------: | :-----------------------: | :--------------------------: | :-------------------: |
|           Agentic AI          | ✗ Scripted workflows only |     ✓ ReAct / multi-Agent    | ✓ ReAct / multi-Agent |
|        No code required       |             ✓             |      ✗ Python mandatory      |           ✓           |
|       Visual composition      |       ✓ Full canvas       |               ✗              |     ✓ Full canvas     |
| Domain expert can build alone |             ✓             |               ✗              |           ✓           |
|   Multi-Agent collaboration   |             ✗             |               ✓              |           ✓           |

</div>

- **Kill WorkFlow** — SoloEngine is fully ReAct-architecture-based. No preset workflows — just Think → Act → Observe → Repeat loops. Every decision is made dynamically at runtime. When an Agent hits an unexpected roadblock, it auto-adjusts its plan — no hardcoded fallback paths.
- **Domain experts build directly** — A lawyer drags a Contract Review Agent onto the canvas, wires it to a Research Agent, hits run. No programmer in the loop.
- **Tools, Skills, MCP — hot-pluggable design, progressive disclosure** — Each Agent loads only the tools and Skills it needs at runtime. Thanks to progressive disclosure, token consumption drops by over 85%.
- **One adapter, any model** — OpenAI, Anthropic, Ollama, DeepSeek, Qwen, Zhipu — same interface, seamless switching.

### How It Works

All Agents share the same underlying architecture — just configured differently. The canvas compiles directly into executable Agentic AI.

1. **Compilation** — Visual layout → Agent DAG via topological sort. One compiler, infinite teams.
2. **One ReAct engine** — Every Agent runs the same Think → Act → Observe → Repeat loop.
3. **Progressive disclosure** — Agents only load what they use at runtime, making low-code agentic AI practical.

## Quick Start

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine

# Backend (Python 3.11+)
cd backend
pip install -r requirements.txt
python main.py

# Frontend (Node.js 18+) — open another terminal
cd frontend 
npm install
npm run dev
```

Open **<http://localhost:8991>** and build your first Agent team.

## Use Cases

- **VibeLawing** — A lawyer drags search, filing, and formatting Agents onto the canvas in sequence, then hits run. AI will automatically break down and plan the legal work: parsing facts, locating statutes, organizing cases, structuring arguments, and formatting documents — all you need to do is review and fine-tune before delivery. The whole process feels as natural as a developer vibe-coding in Cursor.
- **VibeMarketing** — A marketer drags research, copywriting, and asset Agents onto the canvas, then hits run. SoloEngine will automatically analyze the audience, then research relevant product approaches based on the findings, and benchmark against competitors to craft marketing strategies — delivering a polished marketing plan to you.
- **One-click package** — Build your Agent team, hit package, one product ready for anyone.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Sh4r1ock/SoloEngine\&type=Date)](https://star-history.com/#Sh4r1ock/SoloEngine\&Date)

<p align="center">⭐ <b>If you find this useful, give us a star — it helps a lot!</b></p>

## Acknowledgments

Special thanks to:

<p align="center">
  <a href="https://github.com/XiaomiMiMo"><img src="https://avatars.githubusercontent.com/u/208276378?v=4" alt="MiMo" height="200"/></a>
</p>

## Contributing

<p align="center">We are **so** excited to meet you.</p>

<p align="center">Every typo fix, new tool plugin, doc tweak, or full-on feature lands — all of it makes SoloEngine better. Big PRs and small ones, both welcome.</p>

<p align="center">📝 <a href="./CONTRIBUTING.md">Contributing guide</a> &nbsp;·&nbsp; 🐛 <a href="https://github.com/Sh4r1ock/SoloEngine/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22">Good first issues</a> &nbsp;·&nbsp; 📧 <a href="mailto:sh4r1ock@qq.com">sh4r1ock@qq.com</a></p>

## License

<p align="center">Apache License 2.0. See <a href="./LICENSE">LICENSE</a>.</p>

***

<div align="center">

**SoloEngine — AI for Every Industry ❤️**

</div>
