English | [한국어](README.ko.md) | [中文](README.zh.md) | [日本語](README.ja.md) | [Español](README.es.md)

# pumasi

<p align="center">
  <img src="assets/pumasi-hero-01.png" alt="pumasi" width="320">
</p>

> **Parallel coding orchestration — Claude as PM, Codex CLI as your dev team.**

Delegate the building to Codex. Keep the thinking for Claude.

[Quick Start](#quick-start) • [Why pumasi?](#why-pumasi) • [How it works](#how-it-works) • [Features](#features) • [Requirements](#requirements)

---

## Quick Start

### 1. Add the marketplace (once)

```
/plugin marketplace add https://github.com/fivetaku/gptaku_plugins.git
```

### 2. Install

```
/plugin install pumasi
```

Restart Claude Code after installation.

### 3. Install prerequisites

```bash
# Codex CLI
npm install -g @openai/codex

# yaml dependency (one-time)
cd <plugin-dir>/skills/pumasi && npm install yaml
```

### 4. Run

```
/pumasi Build me a Todo app with auth, storage, and API
```

Or trigger naturally — pumasi auto-activates when 3+ independent modules are detected.

---

## Why pumasi?

- **Claude does not write code** — It designs interfaces, writes signatures, and sets requirements. Codex does the actual implementation. Claude tokens stay cheap.
- **N modules in parallel** — Three independent modules take the same wall time as one. Five modules, same story.
- **Zero-token validation** — Each task gets a bash-based gate (type-check, build, test). Gates run without consuming Claude tokens.
- **Dependency-aware rounds** — Tasks with dependencies get split into rounds. Round 1 completes before Round 2 starts. No integration surprises.
- **Codex-aware instructions** — Codex does not infer context. Pumasi writes absolute paths, function signatures, required imports, and hard constraints into every instruction — but never the function body.

---

## How it works

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

### 7-phase workflow

| Phase | Who | What |
|-------|-----|------|
| 0. Plan | Claude | Analyze request, design data model, confirm scope with user |
| 1. Decompose | Claude | Break into independently parallelizable subtasks |
| 2. Configure | Claude | Write signatures + requirements + gates into `pumasi.config.yaml` |
| 3. Execute | pumasi.sh | Spawn N Codex instances in parallel |
| 4. Monitor | pumasi.sh | Wait for all workers to complete |
| 5. Validate | Claude | Run gates (tsc, build, test), read only failing code |
| 6. Integrate | Claude + Codex | Verify cross-task interfaces, re-delegate fixes to Codex |

---

## Features

### Role separation

| Role | Claude | Codex |
|------|--------|-------|
| Requirements analysis | Yes | No |
| Data model design | Yes | No |
| Function signatures | Yes | No |
| Function bodies | **Never** | Yes |
| Gate validation | Yes (run) | No |
| Bug fixes | Delegates | Implements |

### When to use pumasi

| Task count | Recommendation |
|------------|----------------|
| 1–2 tasks | Claude codes directly — pumasi overhead not worth it |
| 3–4 tasks | Pumasi optional — parallel gain roughly offsets setup cost |
| 5+ tasks | Pumasi strongly recommended — parallel gain is clear |

### When NOT to use pumasi

- Bug fixes or modifications to existing code (context injection becomes too heavy)
- Single-file work (no parallel benefit)
- Tasks where gates cannot be defined (fine-tuning UI aesthetics, etc.)

### Pumasi vs `/batch`

| | Pumasi | /batch |
|--|--------|--------|
| **Purpose** | Build N independent new modules in parallel | Apply the same change pattern to N existing files |
| **Workers** | Codex CLI (Codex tokens) | Claude agents (Claude tokens) |
| **Isolation** | Shared working directory | Full git worktree isolation per agent |
| **Good for** | Auth + DB + API, each from scratch | jest→vitest migration, CSS→Tailwind conversion |

### Validation gates

```
Step 0: Install dependencies (npm install if node_modules missing)
Step 1: Run gates — tsc --noEmit → npm run build → npm test → grep checks
Step 2: Pass = read only Codex reports. Fail = read only failing code.
Step 3: Cross-task interface check (types, import paths)
```

### Round-based dependency handling

```
Round 1: Shared types / utilities   (N tasks in parallel)
Round 2: Tasks that depend on Round 1 (M tasks in parallel)
Round 3: Final integration          (Claude direct)
```

### Image generation — `/pumasi:image`

pumasi also ships an image-generation skill (the plugin's second half). Say "make a thumbnail / logo / poster / banner" or `/pumasi:image` and it generates images through **Codex `gpt-image-2` (default — any aspect ratio, strong Korean/English text rendering)** or **Grok `image_gen` (zero marginal cost on SuperGrok; 9:16 / 16:9 / 1:1 only)**. The backend is chosen in one question unless you name it. Images are saved to a project-local path — no clipboard paste, no base64 in the transcript.

### Commands

```bash
pumasi.sh start [--config path] "project context"
pumasi.sh status [JOB_DIR]
pumasi.sh status --text [JOB_DIR]
pumasi.sh wait [JOB_DIR]
pumasi.sh results [JOB_DIR]
pumasi.sh stop [JOB_DIR]
pumasi.sh clean [JOB_DIR]
```

### Triggers

| Trigger | Description |
|---------|-------------|
| `/pumasi [task]` | Start pumasi mode with task description |
| `/pumasi` | Interactive menu |
| "품앗이로 만들어줘" | Natural language trigger |
| "codex 외주로" | Natural language trigger |
| 3+ independent modules detected | Auto-activates |

---

## Requirements

- [Claude Code](https://docs.anthropic.com/claude-code) CLI
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex` (default worker)
- Optional alternative/mixable workers — pick per task at run time: [Grok CLI](https://docs.x.ai/build/overview) (`curl -fsSL https://x.ai/cli/install.sh | bash`), Cursor CLI `cursor-agent` (Composer / Codex / Claude Opus·Fable routing on Cursor Ultra), Antigravity CLI `agy` (design·UI), gajae-code `gjc` (multi-model). Missing ones fall back to Codex.
- Node.js 18+
- OpenAI API key (for Codex)

---

## License

MIT

---

<div align="center">

**Claude thinks. Codex builds. You ship.**

</div>
