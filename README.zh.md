[English](README.md) | [한국어](README.ko.md) | 中文 | [日本語](README.ja.md) | [Español](README.es.md)

# pumasi

<p align="center">
  <img src="assets/pumasi-hero-01.png" alt="pumasi" width="320">
</p>

> **并行编码编排 — Claude 当 PM，Codex CLI 当你的开发团队。**

把动手交给 Codex，把思考留给 Claude。

[快速开始](#快速开始) • [为什么选 pumasi](#为什么选-pumasi) • [工作原理](#工作原理) • [功能](#功能) • [环境要求](#环境要求)

---

## 快速开始

### 1. 添加市场（仅需一次）

```
/plugin marketplace add https://github.com/fivetaku/gptaku_plugins.git
```

### 2. 安装

```
/plugin install pumasi
```

安装后请重启 Claude Code。

### 3. 安装前置依赖

```bash
# Codex CLI
npm install -g @openai/codex

# yaml dependency (one-time)
cd <plugin-dir>/skills/pumasi && npm install yaml
```

### 4. 运行

```
/pumasi Build me a Todo app with auth, storage, and API
```

自然语言也能触发 — 检测到 3 个以上相互独立的模块时，pumasi 会自动启动。

---

## 为什么选 pumasi

- **Claude 不写代码** — 它负责设计接口、编写签名、定义需求，实际实现由 Codex 完成。Claude 的 token 开销始终很低。
- **N 个模块并行** — 三个独立模块的耗时与一个相同；五个模块，同样如此。
- **零 token 验证** — 每个任务都配有基于 bash 的门禁（类型检查、构建、测试），门禁运行不消耗任何 Claude token。
- **感知依赖的轮次划分** — 有依赖关系的任务会被拆分成轮次。Round 1 完成后 Round 2 才开始，集成时没有意外。
- **为 Codex 量身定制的指令** — Codex 不会推断上下文。pumasi 在每条指令里写明绝对路径、函数签名、必需的 import 和硬性约束 — 但绝不写函数体。

---

## 工作原理

```
User request
    │
    ▼
Claude (PM) — plans, decomposes, writes signatures + requirements
    │
    ├──────────────────────────────────┐
    │                                  │
    ▼                                  ▼
Codex #1          Codex #2          Codex #3
(implements)      (implements)      (implements)
    │                 │                 │
    └─────────────────┴─────────────────┘
                      │
                      ▼
           Gate validation (bash, 0 tokens)
                      │
                      ▼
           Claude reviews + integrates
                      │
                      ▼
                   Done
```

### 7 阶段工作流

| 阶段 | 负责方 | 内容 |
|-------|-----|------|
| 0. 规划 | Claude | 分析需求、设计数据模型、与用户确认范围 |
| 1. 拆解 | Claude | 拆分为可独立并行执行的子任务 |
| 2. 配置 | Claude | 把签名 + 需求 + 门禁写入 `pumasi.config.yaml` |
| 3. 执行 | pumasi.sh | 并行拉起 N 个 Codex 实例 |
| 4. 监控 | pumasi.sh | 等待所有 worker 完成 |
| 5. 验证 | Claude | 运行门禁（tsc、build、test），只读失败的代码 |
| 6. 集成 | Claude + Codex | 核对跨任务接口，把修复再委派给 Codex |

---

## 功能

### 角色分工

| 角色 | Claude | Codex |
|------|--------|-------|
| 需求分析 | 是 | 否 |
| 数据模型设计 | 是 | 否 |
| 函数签名 | 是 | 否 |
| 函数体 | **从不** | 是 |
| 门禁验证 | 是（执行） | 否 |
| 缺陷修复 | 委派 | 实现 |

### 什么时候用 pumasi

| 任务数 | 建议 |
|------------|----------------|
| 1–2 个 | Claude 直接写 — pumasi 的开销不划算 |
| 3–4 个 | pumasi 可选 — 并行收益与配置成本大致相抵 |
| 5 个以上 | 强烈推荐 pumasi — 并行收益十分明显 |

### 什么时候不该用 pumasi

- 修复缺陷或改动既有代码（上下文注入会变得过重）
- 单文件工作（没有并行收益）
- 无法定义门禁的任务（UI 视觉微调等）

### pumasi vs `/batch`

| | pumasi | /batch |
|--|--------|--------|
| **目的** | 并行从零构建 N 个独立新模块 | 把同一变更模式套用到 N 个既有文件 |
| **Worker** | Codex CLI（Codex token） | Claude 代理（Claude token） |
| **隔离** | 共享工作目录 | 每个代理独享 git worktree，完全隔离 |
| **适用场景** | 认证 + 数据库 + API，各自从零开始 | jest→vitest 迁移、CSS→Tailwind 转换 |

### 验证门禁

```
Step 0: Install dependencies (npm install if node_modules missing)
Step 1: Run gates — tsc --noEmit → npm run build → npm test → grep checks
Step 2: Pass = read only Codex reports. Fail = read only failing code.
Step 3: Cross-task interface check (types, import paths)
```

### 基于轮次的依赖处理

```
Round 1: Shared types / utilities   (N tasks in parallel)
Round 2: Tasks that depend on Round 1 (M tasks in parallel)
Round 3: Final integration          (Claude direct)
```

### 命令

```bash
pumasi.sh start [--config path] "project context"
pumasi.sh status [JOB_DIR]
pumasi.sh status --text [JOB_DIR]
pumasi.sh wait [JOB_DIR]
pumasi.sh results [JOB_DIR]
pumasi.sh stop [JOB_DIR]
pumasi.sh clean [JOB_DIR]
```

### 触发方式

| 触发 | 说明 |
|---------|-------------|
| `/pumasi [task]` | 附任务描述启动 pumasi 模式 |
| `/pumasi` | 交互式菜单 |
| “품앗이로 만들어줘” | 自然语言触发 |
| “codex 외주로” | 自然语言触发 |
| 检测到 3 个以上独立模块 | 自动启动 |

---

## 环境要求

- [Claude Code](https://docs.anthropic.com/claude-code) CLI
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
- (可选) [Grok CLI](https://docs.x.ai/build/overview) — `curl -fsSL https://x.ai/cli/install.sh | bash`
- Node.js 18+
- OpenAI API 密钥（供 Codex 使用）

---

## 许可证

MIT

---

<div align="center">

**Claude 思考，Codex 构建，你来发布。**

</div>
