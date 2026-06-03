# Contributing to SoloEngine

> **中文版本: [CONTRIBUTING_ZH.md](i18n/contributing/CONTRIBUTING_ZH.md)**

> SoloEngine is an open-source Agentic AI development platform. Thank you for your interest in contributing!

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to abide by its terms.

## How to Contribute

### Reporting Bugs

Before [opening an issue](https://github.com/Sh4r1ock/SoloEngine/issues/new/choose), please:

- Search existing issues to avoid duplicates
- Confirm the bug is reproducible on the latest version
- Provide clear steps to reproduce, expected behavior, and actual behavior

### Feature Requests

Have an idea? Share your design or use case through [Discussions](https://github.com/Sh4r1ock/SoloEngine/discussions).

## Development Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Backend API runs on `http://localhost:8990`, frontend dev server on `http://localhost:8991`.

### Submitting a Pull Request

1. Fork the repo and create a branch
```bash
git checkout -b feature/your-feature
```

2. Make your changes and commit
```bash
git add .
git commit -m "feat: your feature description"
```

3. Push to your fork
```bash
git push origin feature/your-feature
```

4. Open a Pull Request on GitHub

## Coding Standards

- Follow existing code style in the file you are editing
- New features should include tests
- Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/)
- Keep PRs focused — one change per PR

## Need help?

Open an issue or email <a href="mailto:sh4r1ock@qq.com">sh4r1ock@qq.com</a>.
