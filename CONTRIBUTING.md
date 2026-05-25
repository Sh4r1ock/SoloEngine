# SoloEngine 贡献指南

> **English version: [CONTRIBUTING_EN.md](./i18n/contributing/CONTRIBUTING_EN.md)**

> SoloEngine 是一款开源的 Agentic AI 开发平台。感谢你对这个项目的关注与支持！

## 行为准则

本项目采用 [Contributor Covenant 行为准则](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)。参与本项目即表示你同意遵守该准则。

## 如何参与贡献

### 报告 Bug

在[创建 Issue](https://github.com/Sh4r1ock/SoloEngine/issues/new/choose) 之前，请先：

- 在 GitHub Issues 中搜索是否有重复问题
- 确认该 Bug 在最新版本中可以复现
- 提供清晰的复现步骤、期望结果与实际结果

### 功能建议

如果你有好的想法，欢迎通过 [Discussion](https://github.com/Sh4r1ock/SoloEngine/discussions) 分享你的设计思路或使用场景。

## 开发环境搭建

### 后端

```bash
cd backend
pip install -r requirements.txt
python main.py
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

### 提交 Pull Request

1. Fork 本仓库并创建分支
```bash
git checkout -b feature/your-feature
```

2. 进行开发并提交代码
```bash
git add .
git commit -m "feat: 你的功能描述"
```

3. 推送到你的 Fork 仓库
```bash
git push origin feature/your-feature
```

4. 在 GitHub 上发起 Pull Request

## 编码规范

- 遵循现有代码风格
- 新增功能需提供相应的测试用例
- 提交信息需遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范
- PR 保持专注，单一职责

## 联系我们

有任何问题或建议，欢迎通过以下方式联系：

📧 <a href="mailto:sh4r1ock@qq.com">sh4r1ock@qq.com</a>
