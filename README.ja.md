[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md) | 日本語 | [Español](README.es.md)

# pumasi

<p align="center">
  <img src="assets/pumasi-hero-01.png" alt="pumasi" width="320">
</p>

> **並列コーディングのオーケストレーション — Claude が PM、Codex CLI が開発チーム。**

作るのは Codex に任せて、考えるのは Claude に。

[クイックスタート](#クイックスタート) • [なぜ pumasi なのか](#なぜ-pumasi-なのか) • [仕組み](#仕組み) • [機能](#機能) • [動作要件](#動作要件)

---

## クイックスタート

### 1. マーケットプレイスを追加（初回のみ）

```
/plugin marketplace add https://github.com/fivetaku/gptaku_plugins.git
```

### 2. インストール

```
/plugin install pumasi
```

インストール後、Claude Code を再起動してください。

### 3. 前提ツールのインストール

```bash
# Codex CLI
npm install -g @openai/codex

# yaml dependency (one-time)
cd <plugin-dir>/skills/pumasi && npm install yaml
```

### 4. 実行

```
/pumasi Build me a Todo app with auth, storage, and API
```

自然な言葉でも起動します — 独立したモジュールが 3 つ以上検出されると、pumasi が自動で作動します。

---

## なぜ pumasi なのか

- **Claude はコードを書かない** — インターフェース設計、シグネチャ作成、要件定義に徹します。実装は Codex の仕事。Claude のトークンは安く済みます。
- **N 個のモジュールを並列で** — 独立した 3 モジュールにかかる実時間は 1 モジュール分と同じ。5 モジュールでも同じ話です。
- **トークン 0 の検証** — 各タスクに bash ベースのゲート（型チェック、ビルド、テスト）が付きます。ゲートは Claude のトークンを一切消費せずに実行されます。
- **依存関係を考慮したラウンド分割** — 依存のあるタスクはラウンドに分割されます。Round 1 が完了してから Round 2 が始まるので、統合時のサプライズはありません。
- **Codex 向けに最適化された指示** — Codex はコンテキストを推測しません。pumasi は絶対パス、関数シグネチャ、必須 import、ハード制約をすべての指示に書き込みます — ただし関数本体は決して書きません。

---

## 仕組み

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

### 7 フェーズのワークフロー

| フェーズ | 担当 | 内容 |
|-------|-----|------|
| 0. 計画 | Claude | リクエストを分析し、データモデルを設計し、ユーザーとスコープを確認 |
| 1. 分解 | Claude | 独立して並列実行できるサブタスクに分解 |
| 2. 設定 | Claude | シグネチャ + 要件 + ゲートを `pumasi.config.yaml` に記述 |
| 3. 実行 | pumasi.sh | Codex インスタンスを N 個並列でスポーン |
| 4. 監視 | pumasi.sh | 全ワーカーの完了を待機 |
| 5. 検証 | Claude | ゲートを実行（tsc、build、test）し、失敗したコードだけを読む |
| 6. 統合 | Claude + Codex | タスク間インターフェースを検証し、修正は Codex に再委任 |

---

## 機能

### 役割分担

| 役割 | Claude | Codex |
|------|--------|-------|
| 要件分析 | する | しない |
| データモデル設計 | する | しない |
| 関数シグネチャ | する | しない |
| 関数本体 | **決して書かない** | する |
| ゲート検証 | する（実行） | しない |
| バグ修正 | 委任する | 実装する |

### pumasi を使うべきとき

| タスク数 | 推奨 |
|------------|----------------|
| 1〜2 個 | Claude が直接コーディング — pumasi のオーバーヘッドに見合わない |
| 3〜4 個 | pumasi は任意 — 並列の利得とセットアップコストがほぼ相殺 |
| 5 個以上 | pumasi を強く推奨 — 並列の利得が明確 |

### pumasi を使うべきでないとき

- 既存コードのバグ修正や変更（コンテキスト注入が重くなりすぎる）
- 単一ファイルの作業（並列の利点なし）
- ゲートを定義できないタスク（UI の見た目の微調整など）

### pumasi vs `/batch`

| | pumasi | /batch |
|--|--------|--------|
| **目的** | 独立した新規モジュール N 個を並列で構築 | 同じ変更パターンを既存ファイル N 個に適用 |
| **ワーカー** | Codex CLI（Codex トークン） | Claude エージェント（Claude トークン） |
| **分離** | 作業ディレクトリを共有 | エージェントごとに git worktree で完全分離 |
| **向いている作業** | 認証 + DB + API をそれぞれゼロから | jest→vitest 移行、CSS→Tailwind 変換 |

### 検証ゲート

```
Step 0: Install dependencies (npm install if node_modules missing)
Step 1: Run gates — tsc --noEmit → npm run build → npm test → grep checks
Step 2: Pass = read only Codex reports. Fail = read only failing code.
Step 3: Cross-task interface check (types, import paths)
```

### ラウンドベースの依存関係処理

```
Round 1: Shared types / utilities   (N tasks in parallel)
Round 2: Tasks that depend on Round 1 (M tasks in parallel)
Round 3: Final integration          (Claude direct)
```

### コマンド

```bash
pumasi.sh start [--config path] "project context"
pumasi.sh status [JOB_DIR]
pumasi.sh status --text [JOB_DIR]
pumasi.sh wait [JOB_DIR]
pumasi.sh results [JOB_DIR]
pumasi.sh stop [JOB_DIR]
pumasi.sh clean [JOB_DIR]
```

### トリガー

| トリガー | 説明 |
|---------|-------------|
| `/pumasi [task]` | タスク説明を添えて pumasi モードを開始 |
| `/pumasi` | インタラクティブメニュー |
| 「품앗이로 만들어줘」 | 自然言語トリガー |
| 「codex 외주로」 | 自然言語トリガー |
| 独立モジュール 3 つ以上を検出 | 自動作動 |

---

## 動作要件

- [Claude Code](https://docs.anthropic.com/claude-code) CLI
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
- (任意) [Grok CLI](https://docs.x.ai/build/overview) — `curl -fsSL https://x.ai/cli/install.sh | bash`
- Node.js 18+
- OpenAI API キー（Codex 用）

---

## ライセンス

MIT

---

<div align="center">

**Claude が考える。Codex が作る。あなたが世に出す。**

</div>
