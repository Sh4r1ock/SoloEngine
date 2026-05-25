# Contributing to SoloEngine

Thank you for your interest in contributing to SoloEngine! Here are a few guidelines to help get you started.

This project and everyone participating in it are governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Setup

See the [Quick Start](./README.md#quick-start) in README for one-time setup.

For development:

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

Backend API runs on `http://localhost:8990`, frontend dev server on `http://localhost:8991`.

## What to contribute

- **Tool plugins** — new `plugins/tools/` implementations (file, network, shell, search, etc.)
- **MCP clients** — new `plugins/mcp/` providers (stdio, SSE, HTTP)
- **Memory backends** — new `plugins/memory/` implementations
- **Model adapters** — new `model/` providers beyond OpenAI, Anthropic, Ollama, Qwen
- **Bug fixes** — check [good first issues](https://github.com/Sh4r1ock/SoloEngine/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- **Documentation** — README improvements, inline docs, examples

## Proposing a change

Before opening a non-trivial pull request, please open an issue to discuss the change with maintainers. This avoids duplicate work and ensures your change fits the project direction.

## Pull requests

- Keep PRs focused on a single change
- Follow existing code style in the file you are editing
- No `ts-ignore` or type suppressions
- Reuse existing abstractions (`interfaces.py`, `model_base.py`, etc.) instead of introducing new patterns

## Need help?

Open an issue or email [sh4r1ock@qq.com](mailto:sh4r1ock@qq.com).