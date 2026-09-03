[English](README.md) | 한국어 | [中文](README.zh.md) | [日本語](README.ja.md) | [Español](README.es.md)

# 품앗이 (Pumasi)

<p align="center">
  <img src="assets/pumasi-hero-01.png" alt="pumasi" width="320">
</p>

> **병렬 코딩 오케스트레이션 — Claude가 PM, Codex CLI가 개발팀.**

짓는 건 Codex에게. 생각하는 건 Claude가.

[빠른 시작](#빠른-시작) • [왜 품앗이인가?](#왜-품앗이인가) • [어떻게 작동하나요?](#어떻게-작동하나요) • [기능](#기능) • [요구사항](#요구사항)

---

## 빠른 시작

### 1. 마켓플레이스 등록 (처음 한 번만)

```
/plugin marketplace add https://github.com/fivetaku/gptaku_plugins.git
```

### 2. 설치

```
/plugin install pumasi
```

설치 후 Claude Code를 재시작하세요.

### 3. 사전 요구사항 설치

```bash
# Codex CLI
npm install -g @openai/codex

# yaml 의존성 (최초 1회)
cd <plugin-dir>/skills/pumasi && npm install yaml
```

### 4. 실행

```
/pumasi Todo 앱 만들어줘. 인증, 저장소, API 포함
```

자연어로도 됩니다 — 3개 이상의 독립 모듈이 감지되면 품앗이가 자동으로 켜집니다.

---

## 왜 품앗이인가?

- **Claude는 코드를 짜지 않는다** — 인터페이스 설계, 시그니처 작성, 요구사항 정의만 합니다. 실제 구현은 Codex가 합니다. Claude 토큰을 아낍니다.
- **N개 모듈을 동시에** — 독립적인 모듈 3개를 만들어야 하면, 1개 만드는 시간에 3개가 완성됩니다.
- **토큰 0으로 검증** — 각 태스크마다 bash 기반 게이트(타입 체크, 빌드, 테스트)를 자동 생성합니다. Claude 토큰 소비 없이 검증합니다.
- **의존성 라운드 처리** — 태스크 간 의존성이 있으면 라운드로 분리합니다. Round 1이 완료된 뒤 Round 2가 시작됩니다. 통합 시 충돌이 없습니다.
- **Codex에 맞는 instruction** — Codex는 컨텍스트를 추론하지 않습니다. 품앗이는 절대 경로, 함수 시그니처, 필수 import, 제약사항을 모두 명시합니다. 단, 함수 본문은 절대 작성하지 않습니다.

---

## 어떻게 작동하나요?

```
사용자 요청
    │
    ▼
Claude (PM) — 기획, 분해, 시그니처 + 요구사항 작성
    │
    ├──────────────────────────────────┐
    │                                  │
    ▼                                  ▼
Codex #1          Codex #2          Codex #3
(구현)            (구현)            (구현)
    │                 │                 │
    └─────────────────┴─────────────────┘
                      │
                      ▼
           게이트 검증 (bash, 토큰 0)
                      │
                      ▼
           Claude 검토 + 통합
                      │
                      ▼
                   완성
```

### 7단계 워크플로우

| 단계 | 담당 | 내용 |
|------|------|------|
| 0. 기획 | Claude | 요청 분석, 데이터 모델 설계, 사용자 승인 |
| 1. 분해 | Claude | 독립 병렬 실행 가능한 서브태스크로 분해 |
| 2. 설정 | Claude | `pumasi.config.yaml`에 시그니처 + 요구사항 + 게이트 작성 |
| 3. 실행 | pumasi.sh | Codex 인스턴스 N개 병렬 스폰 |
| 4. 모니터링 | pumasi.sh | 모든 워커 완료 대기 |
| 5. 검증 | Claude | 게이트 실행(tsc, build, test), 실패 코드만 읽기 |
| 6. 통합 | Claude + Codex | 서브태스크 간 인터페이스 확인, 수정은 Codex에 재위임 |

---

## 기능

### 역할 분리

| 역할 | Claude | Codex |
|------|--------|-------|
| 요구사항 분석 | 담당 | 미담당 |
| 데이터 모델 설계 | 담당 | 미담당 |
| 함수 시그니처 작성 | 담당 | 미담당 |
| 함수 본문 작성 | **절대 안 함** | 담당 |
| 게이트 검증 실행 | 담당 | 미담당 |
| 버그 수정 | 위임 결정 | 실제 수정 |

### 언제 품앗이를 쓸까?

| 태스크 수 | 권장 방식 |
|-----------|----------|
| 1~2개 | Claude 직접 코딩 — 품앗이 오버헤드가 더 큼 |
| 3~4개 | 품앗이 사용 가능 — 병렬 이득이 설정 비용과 비슷 |
| 5개 이상 | 품앗이 강력 권장 — 병렬 이득이 확실히 큼 |

### 품앗이를 쓰면 안 되는 경우

- 기존 코드 수정/버그 수정 (컨텍스트 주입이 과도해짐)
- 단일 파일 작업 (병렬 이점 없음)
- 게이트를 만들 수 없는 작업 (UI 미세 조정 등)

### 품앗이 vs `/batch`

| | 품앗이 | /batch |
|--|--------|--------|
| **목적** | 독립 모듈 N개를 처음부터 병렬 구현 | 동일 패턴을 N개 기존 파일에 반복 적용 |
| **워커** | Codex CLI (Codex 토큰) | Claude 에이전트 (Claude 토큰) |
| **격리** | 공유 워킹 디렉토리 | git worktree별 완전 격리 |
| **적합한 작업** | 인증 + DB + API 각각 새로 만들기 | jest→vitest 마이그레이션, CSS→Tailwind 변환 |

### 검증 게이트

```
Step 0: 의존성 확인 (node_modules 없으면 npm install)
Step 1: 게이트 실행 — tsc --noEmit → npm run build → npm test → grep 확인
Step 2: 전부 통과 = Codex 보고서만 읽기. 실패 있음 = 실패 코드만 읽기.
Step 3: 서브태스크 간 인터페이스 확인 (타입, import 경로)
```

### 라운드 기반 의존성 처리

```
Round 1: 공유 타입 / 유틸리티   (N개 병렬)
Round 2: Round 1 결과 사용 태스크 (M개 병렬)
Round 3: 최종 통합              (Claude 직접)
```

### 이미지 생성 — `/pumasi:image`

품앗이에는 이미지 생성 스킬도 들어 있습니다(플러그인의 나머지 절반). "썸네일/로고/포스터/배너 만들어줘" 또는 `/pumasi:image`라고 하면 **Codex `gpt-image-2`(기본 — 임의 비율, 한글·영문 텍스트 렌더 강함)** 또는 **Grok `image_gen`(SuperGrok 구독 시 한계비용 0, 단 9:16·16:9·1:1만)** 으로 생성합니다. 백엔드는 지명하지 않으면 질문 1번으로 고르고, 결과는 프로젝트 로컬 경로에 파일로 저장됩니다(클립보드 붙이기·base64 없음).

### 커맨드

```bash
pumasi.sh start [--config path] "프로젝트 컨텍스트"
pumasi.sh status [JOB_DIR]
pumasi.sh status --text [JOB_DIR]
pumasi.sh wait [JOB_DIR]
pumasi.sh results [JOB_DIR]
pumasi.sh stop [JOB_DIR]
pumasi.sh clean [JOB_DIR]
```

### 트리거

| 트리거 | 설명 |
|--------|------|
| `/pumasi [작업]` | 품앗이 모드로 작업 시작 |
| `/pumasi` | 인터랙티브 메뉴 |
| "품앗이로 만들어줘" | 자연어 트리거 |
| "codex 외주로" | 자연어 트리거 |
| 3개 이상 독립 모듈 감지 | 자동 활성화 |

---

## 요구사항

- [Claude Code](https://docs.anthropic.com/claude-code) CLI
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex` (기본 워커)
- 선택 — 태스크별로 바꿔 쓸 수 있는 대체 워커: [Grok CLI](https://docs.x.ai/build/overview) (`curl -fsSL https://x.ai/cli/install.sh | bash`), Cursor CLI `cursor-agent`(Cursor Ultra 구독 시 Composer·Codex·Claude Opus/Fable 선택), Antigravity CLI `agy`(디자인·UI), gajae-code `gjc`(멀티모델). 미설치면 Codex로 폴백.
- Node.js 18+
- OpenAI API 키 (Codex 실행용)

---

## 라이선스

MIT

---

<div align="center">

**Claude가 생각하고. Codex가 짓고. 당신이 출시한다.**

</div>
