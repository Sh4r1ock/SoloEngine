---
description: "Web 右侧 Sidebar 的行式 agent 终端 tab：挂到本会话的平台终端，读取有界 scrollback，一次发送一行，并在刷新后恢复所接的终端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-terminal

[English](README.md) | 中文

## 概述

在右侧 Sidebar 打开终端 tab，接续当前会话的 agent 终端。面板挂到终端工具所操作的那批平台 PTY 会话，显示其有界 scrollback，一次发送一行；归属是本会话的，因此一个会话永远够不到另一个会话的终端。契约为行式，全屏 TUI 程序不在此呈现。页面刷新后标签页恢复到同一条终端；Host 重启后面板回放会话日志已持久的部分，并把新终端标注为新代际。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

命令 `terminal.new` 在焦点停靠分栏打开一个终端 tab，替换开始页并保留已有内容页。Windows 与 macOS Web 使用[快捷键服务的平台默认值](../shortcuts/README.zh.md)；Linux Web 默认不绑定该命令。开始页卡片把当前有效快捷键以无边框文本右对齐，不再重复一个 tooltip。

不带 `terminalId` 打开的 tab 先恢复刷新前所接的那条终端，其次复用本会话第一个 agent 终端；会话还没有终端时创建一条。带 `{ terminalId }` 打开的 tab 挂到那一条确切终端，包括终端工具创建的终端。chip 条列出本会话的终端，**新建终端**再创建一条。注册表已不再持有的终端显示本地化的「终端已不存在」一行，而不是传输层消息。

终端 tab 可见且进程在运行时，面板轮询当前终端的 scrollback；tab 隐藏时暂停，进程退出即停止（注册表报告时显示退出码）。回车或**发送**写入输入行；**中断**向前台命令投递 `SIGINT`。关闭 tab 不会杀掉终端，因为 agent 可能仍在使用它；只丢弃该 tab 的恢复记录。

Host 重启后终端进程不在了，但有界输出还在：`terminal_send` 把每次前台视口作为工具结果的呈现元数据发布，会话日志将其持久化。面板把这段已持久输出显示在实时屏幕上方，并把新建的终端标注为新代际。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部——点击展开</summary>

插件向右侧 Sidebar 注册 `terminal` 类型、开始页卡片、`sidebar.right.pane.tab` 下以 key 定位的正文，以及静态 chip 标题。正文收到绑定到该 tab 会话的注入面：`list`、`spawn`、`read`、`send`、`interrupt` 调用 [`api-terminal-controller`](../../api/terminal-controller/README.zh.md#agent-terminals) 上 `remote.terminal` 的 agent 终端方法（`agentTerminals`、`agentSpawn`、`agentRead`、`agentSend`、`agentSignal`）；`persisted` 经 `ctx.sessions` 读取同一会话已加载的事件窗口，在不发起 Host 调用的情况下重建其工具结果视口。

终端注册表（`ctx.terminals`）是终端会话的唯一事实源，因此面板显示的就是终端工具使用的那一套；归属由 Host 侧注册表判定，而不是浏览器。分页按最新优先、有界行数请求，面板只保留一页而不是不断增长的缓冲。tab 记录的中止信号是每次调用的生命周期；记录对象重建不会重启打开副作用，因为信号通过 ref 读取。

Sidebar 持久化 tab 记录但不保留导航参数，因此由 tab 自己的恢复记录（`tab → terminalId`，按浏览器 profile 有界）承载刷新前后的绑定。关闭 tab 时经 Sidebar 的关闭处理注销该记录；终端本身保持不动。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [终端控制器](../../api/terminal-controller/README.zh.md)
- [终端注册表](../../terminal/terminal/README.zh.md)
- [右侧 Sidebar](../../client/ui-sidebar-right/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无，因为本包只处理用户侧的终端交互，不增加模型输入。

#### KV Cache 影响

无；终端输出只在浏览器与 Host 之间传输。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只有行式契约。**全屏 TUI 程序不呈现，面板显示注册表保留的行。
- **只有一页 scrollback。**超出请求页的更早保留输出尚未分页接入。
- **没有重命名与 resize。**终端沿用创建者给的名字，面板不调整 PTY 尺寸。
- **历史有界。**不把终端输出送给 Agent，也不在 Host 重启后恢复进程；只回放会话日志仍通过工具结果持有的有界输出。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
