# pi-trace

**pi-trace** 是 [pi-coding-agent](https://github.com/Earendil-Works/pi-coding-agent) 的一款扩展，提供 **大模型 API 请求的代理转发与全链路追踪** 功能。

通过拦截 pi-code-agent 的大模型请求，pi-trace 能够：
- 🚀 **代理转发**：将请求路由至本地 Express 服务器，实现请求/响应的可观测
- 📝 **全链路日志**：自动记录每次会话的所有事件（用户输入、工具调用、模型选择等）
- 🔍 **请求追踪**：持久化每轮对话的完整请求/响应数据，便于调试和分析
- 🎛️ **TUI 交互面板**：在终端内可视化地切换供应商、管理代理设置

---

## 目录结构

```
src/
├── types/
│   └── index.ts                  # OnOff 通用开关类型
├── constant/
│   └── requestFlag.ts          # 自定义请求常量定义
├── proxy/
│   ├── index.ts                  # 扩展入口（加载初始化）
│   ├── pi.ts                     # .pi 项目配置目录工具
│   ├── utils.ts                  # OnOff ↔ boolean 转换工具
│   ├── logger.ts                 # 事件持久化（所有 pi 事件 → 文件系统）
│   ├── provider.ts               # 大模型供应商管理
│   └── trace.ts                  # 代理服务器启动 & /proxy TUI 命令
└── server/
    ├── app.ts                    # Express 代理服务器
    ├── utils.ts                  # 请求元信息解析
    ├── RequestLogInfo.ts         # 请求日志记录器
    └── router/
        └── openai.ts             # OpenAI 兼容 API 代理路由（SSE 流转发）
```

---

## 工作流程

```
┌──────────────────────────────────────────────────────────┐
│                     pi-coding-agent                       │
│                                                          │
│   用户输入 → before_provider_request → 大模型 API 调用    │
│                    │                                     │
│                    │ (拦截并注入追踪信息)                   │
│                    ▼                                     │
│  ┌─────────────────────────────────────┐                 │
│  │          pi-trace 代理服务器          │                 │
│  │         http://localhost:{port}       │                 │
│  │                                      │                 │
│  │  /openai-completions/chat/completions│                 │
│  │       │                              │                 │
│  │       │ (转发 & 记录)                  │                 │
│  │       ▼                              │                 │
│  │  原始大模型 API (DeepSeek/OpenAI...)  │                 │
│  └─────────────────────────────────────┘                 │
│                                                          │
│  日志输出: .traces/{sessionId}/                          │
│            ├── summary.txt        (全部事件汇总)          │
│            ├── model_select.txt    (模型选择事件)          │
│            ├── tool_call.txt       (工具调用事件)          │
│            ├── turn_start.txt      (轮次事件)              │
│            └── request/            (HTTP 请求日志)         │
│                 ├── 01.json                               │
│                 ├── 02.json                               │
│                 └── ...                                   │
└──────────────────────────────────────────────────────────┘
```

---

## 安装与使用

### 安装

```bash
# 在 pi-code-agent 扩展目录中安装
pi extension add /path/to/pi-trace
```

### 使用

#### 1. 启动会话

扩展会在 pi 启动时自动加载，并启动本地代理服务器。你会在编辑器下方看到：

```
当前服务运行地址: http://localhost:xxxxx
是否使用代理路径: 否
代理是否转发请求: 否
```

#### 2. 开启代理

在 pi 中输入 `/proxy`，通过 TUI 设置面板开启代理：

- **是否使用代理路径**: `on` — 请求将经过本地代理服务器
- **是否让代理转发请求**: `on` — 代理服务器会将请求转发到真实 API

#### 3. 选择供应商

输入 `/provider`，在弹出的面板中选择你想要使用的大模型供应商。

#### 4. 查看日志

所有请求和事件日志位于项目根目录下的 `.traces/{sessionId}/`：

```
.traces/
└── session_abc123/
    ├── summary.txt          # 全部事件时间线
    ├── request/
    │   ├── 01.json           # 第 1 轮：请求 + 响应
    │   └── 02.json           # 第 2 轮：请求 + 响应
    ├── tool_call.txt         # 工具调用详情
    └── ...
```

每轮请求的 JSON 日志格式：

```json
{
  "turnIndex": 1,
  "updateDate": "2025/1/1 12:00:00",
  "originalUrl": "https://api.deepseek.com/v1",
  "request": {
    "method": "POST",
    "path": "/openai-completions/chat/completions",
    "headers": { ... },
    "body": { ... }
  },
  "response": {
    "status": 200,
    "body": { "choices": [{ "delta": { "content": "你好！..." } }] }
  }
}
```

---

## 配置

项目配置存储在 `.pi/provider.json`：

```json
{
  "defaultProvider": "deepseek",
  "useProxy": false,
  "proxyForwardRequest": false,
  "providers": {
    "deepseek": {
      "name": "DeepSeek",
      "originalUrl": "https://api.deepseek.com/v1",
      "proxyUrl": "http://localhost:12345/openai-completions",
      "apiKey": "sk-xxx",
      "defaultModel": "deepseek-chat",
      "defaultModelApi": "/openai-completions"
    }
  }
}
```

---

## 技术要点

### SSE 流式代理

`server/router/openai.ts` 通过流式读取器（`ReadableStream.getReader()`）实现零缓存的 SSE 直传。同时在后台聚合 delta 片段，确保日志中记录的是完整的对话内容，而非碎片化的流式数据。

### 事件持久化

`proxy/logger.ts` 监听了 pi 框架的 **25+ 个事件**，覆盖从会话启动到关闭的完整生命周期。每个事件类型独立存储，同时汇总到 `summary.txt`。

### 供应商管理

`proxy/provider.ts` 实现了供应商的动态注册与切换。当启用代理时，模型请求的 `baseUrl` 会被替换为本地代理地址；当关闭代理时，恢复为原始 API 地址。

---

## 命令速查

| 命令 | 说明 |
|------|------|
| `/proxy` | 打开代理设置面板（开启/关闭代理、转发） |
| `/provider` | 打开供应商选择面板 |

---
