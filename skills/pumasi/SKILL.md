---
name: pumasi
description: Parallel coding orchestration — Claude takes the PM/architect role, Codex CLI instances act as parallel outsource developers. Auto-triggers when 3+ independent modules need concurrent implementation. Distributes subtasks to Codex, then Claude reviews and integrates. Korean triggers: "/pumasi", "품앗이로 만들어줘", "품앗이 켜줘", "codex 외주로", "codex한테 시켜". English triggers: "pumasi", "parallel with codex", "delegate to codex", "codex outsource". DO NOT trigger on image-generation requests like "이미지 만들어줘", "썸네일 만들어", "로고 만들어줘", "make image", "create thumbnail" — including when they name Codex ("코덱스로 이미지 만들어줘", "codex로 그림 뽑아줘"). Those belong to the image skill (/pumasi:image), which also drives Codex.
---

<!-- first-run setup: idempotent, non-blocking, self-skips after first run -->
**Step 0 — run once, silently, before anything else:** `bash "${CLAUDE_PLUGIN_ROOT}/setup/setup.sh" >/dev/null 2>&1 || true` — do not narrate or comment on it, then continue.

# 품앗이 (Pumasi) — Codex 병렬 외주 개발

> 품앗이: 서로 협력하며 일을 나눠 하는 한국 전통 방식
> Claude = 설계/감독 | Codex × N = 병렬 구현자

## 개념

```
┌─────────────────────────────────────────────────────────┐
│              Claude Code (설계/감독/PM)                   │
│  1. 요구사항 분석 → 기획 → 독립 서브태스크 분해           │
│  2. 시그니처 + 요구사항 + 게이트 작성                     │
│  3. pumasi.sh 실행 → Codex 병렬 스폰                     │
│  4. 게이트 검증 → 통합                                   │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ Codex #1 │     │ Codex #2 │     │ Codex #3 │
  │ 시그니처  │     │ 시그니처  │     │ 시그니처  │
  │ 기반 구현 │     │ 기반 구현 │     │ 기반 구현 │
  └──────────┘     └──────────┘     └──────────┘
        │                 │                 │
        └─────────────────┴─────────────────┘
                          │
                          ▼
              게이트 검증 → 통합 → 완성
```

## 핵심 가치

**품앗이의 존재 이유는 "Claude가 코드를 짜지 않는 것"이다.**

| 가치 | 설명 |
|------|------|
| Claude 토큰 절약 | Claude는 설계만, 구현은 Codex가 담당 |
| 속도 향상 | N개 모듈을 Codex가 병렬로 동시 구현 |
| 검증 최적화 | 동적 게이트(bash, 토큰 0)로 자동 검증 |

**전제 조건**: Codex가 **실제 구현**을 해야 한다. Claude가 코드를 다 짜고 Codex에게 복사만 시키면 토큰 절약 효과 = 0.

---

## 안티패턴 및 역할 분리

> **instruction 작성 전 반드시 Read**:
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/anti-patterns.md` — 복붙형 instruction 절대 금지 규칙
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/role-separation.md` — Claude vs Codex 역할 경계, 경계선 예시

**핵심 원칙 요약**: Claude는 시그니처+요구사항만 작성. 코드 본문(body)은 절대 작성 금지. 강한 게이트(tsc/build/test)로 검증.

---

## 트리거 조건

```
명시적 트리거:
- "/pumasi [작업]"
- "품앗이로 [작업]해줘"
- "품앗이 켜줘"
- "codex 외주로 [작업]"
- "codex한테 [작업] 시켜"

자동 감지 (대규모 코딩 요청 시):
- 4개 이상의 독립 파일/모듈 동시 작성 요청
- "전체 [기능] 구현해줘" + 규모가 큰 경우
- 여러 컴포넌트/서비스를 한 번에 만들어야 할 때
```

### 작업 규모별 분기 (중요)

| 규모 | 권장 방식 | 이유 |
|------|----------|------|
| 태스크 1~2개 | **Claude 직접 코딩** | 품앗이 오버헤드가 더 큼 |
| 태스크 3~4개 | **품앗이 사용 가능** | 병렬 이득이 오버헤드와 비슷 |
| 태스크 5개+ | **품앗이 강력 권장** | 병렬 이득이 확실히 큼 |

**또한 다음 경우에는 품앗이를 사용하지 않는다:**
- 기존 코드 수정/버그 수정 (컨텍스트 주입이 과도해짐)
- 단일 파일 작업 (병렬 이점 없음)
- 게이트를 만들 수 없는 작업 (UI 미세 조정 등)

### /batch와의 관계

품앗이와 `/batch`는 목적이 다르다. 상호 보완적이며, 대체 관계가 아니다.

| | 품앗이 (Pumasi) | /batch |
|--|----------------|--------|
| **목적** | 독립 모듈 N개 동시 구현 (Greenfield) | 동일 패턴을 N개 파일에 반복 적용 (Brownfield) |
| **워커** | Codex CLI (Codex 토큰) | Claude 에이전트 (Claude 토큰) |
| **격리** | 동일 워킹 디렉토리 | git worktree별 완전 격리 |
| **적합한 작업** | 인증 + DB + API 각각 만들기 | jest→vitest 마이그레이션, CSS→Tailwind 변환 |

### 품앗이 모드 진입 시 Claude의 행동 변화

```
일반 모드:          품앗이 모드:
Claude가 직접 코딩  Claude가 시그니처+요구사항 작성
                   → pumasi.sh 실행 → Codex가 구현
                   → 게이트 자동 검증 → 통합
```

---

## 7단계 워크플로우

### Phase 0: 기획 (Claude as PM)

사용자 요청을 분석하여 **완성도 있는 기획안**을 작성. 기획 체크리스트 통과 후 사용자 승인을 받는다.

**기획 체크리스트** (태스크 분해 전 반드시 확인):

```
□ 이 앱/기능의 핵심 사용 시나리오는?
□ 경쟁 제품/일반적 기대치 대비 빠진 기능은?
□ 데이터 모델에 필요한 필드가 충분한가?
□ UX 관점: 검색, 정렬, 필터, 벌크 작업이 필요한가?
□ 비기능 요구사항: 반응형, 다크모드, 접근성은?
□ 태스크 수가 4개 이상인가? (아니면 Claude 직접 코딩)
```

**데이터 모델 설계 원칙**: 타입/인터페이스는 Claude가 설계. 구현 로직은 Codex가 작성.

### Phase 0.5: 워커 선택 (AskUserQuestion 필수 — 스킵 조건 있음)

기획 승인을 받는 **같은 AskUserQuestion 콜의 `questions` 배열**에 워커 선택 문항을 포함한다 (블로킹 질문을 늘리지 않기 위해 별도 콜 금지). 텍스트로 묻지 말 것.

**스킵 조건**: 사용자가 요청에서 워커를 이미 지명한 경우("grok으로", "codex한테", "agy 외주") — 지명된 워커를 그대로 쓰고 묻지 않는다.

문항 구성:
- header: "외주 워커"
- question: "어떤 CLI 워커에게 외주를 맡길까요?"
- options (4개):
  1. **Codex (권장)** — 기본 워커. `--output-schema` 구조화 보고(report.json) 지원, 기본 샌드박스
  2. **Grok** — xAI Grok Build (grok-4.6). SuperGrok 구독이면 한계비용 0. report.json 없이 output.txt 통합
  3. **혼합** — 태스크 성격별로 codex/grok/cursor/agy/gjc 나눠 배정 (배정안은 Claude가 제안 후 config에 task별 `command:`로 반영)
  4. **Cursor / agy / gjc** — Cursor Ultra 구독이면 cursor-agent(Composer·Codex·**Claude Opus/Fable까지** 선택 가능), 디자인·UI는 Antigravity(agy), 멀티모델은 gajae-code(gjc)

선택 결과는 Phase 2에서 `.pumasi/pumasi.config.yaml`의 `defaults.command:`(혼합이면 task별 `command:`)에 반영한다. 각 워커의 정확한 command 문자열은 아래 **"외주 워커 교체"** 절의 것을 그대로 쓴다.

**선택 직후 설치 확인 1회**: `command -v <cli>` (grok은 실패 시 `$HOME/.grok/bin/grok` 폴백 — 셸 프로필 PATH라 비대화형에서 안 잡힐 수 있음). 미설치면 사용자에게 알리고 codex로 폴백한다.

### Phase 1: 분석 (Claude)

요청을 받으면 **독립적으로 병렬 실행 가능한** 서브태스크로 분해.

**좋은 서브태스크 조건**:
- 다른 서브태스크 완료를 기다리지 않아도 됨
- 명확한 입출력(시그니처) 정의 가능
- Codex 혼자 구현 가능한 범위
- 파일/기능 경계가 명확함

### Phase 2: 설정 (Claude)

`.pumasi/pumasi.config.yaml`(프로젝트 디렉토리 기준)의 `tasks:` 섹션을 수정.

> **중요**: 반드시 **프로젝트 디렉토리**에 `.pumasi/pumasi.config.yaml`을 생성/수정한다 (`pumasi-job.js`의
> `resolveDefaultConfigFile`이 1순위로 찾는 경로). 플러그인 루트의 `${CLAUDE_PLUGIN_ROOT}/pumasi.config.yaml`은
> 예시 파일일 뿐이며 업데이트 시 덮어써지므로 **절대 직접 수정하지 않는다**.

> **instruction 작성 전 반드시 Read**:
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/codex-guide.md` — Codex 특성, DO/DON'T 규칙, 라이브러리 대체 방지
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/instruction-templates.md` — 템플릿, 좋은/나쁜 예시, 자기 점검 체크리스트
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/tech-stack.md` — 2025-2026 기준 모던 스택 추천표

**instruction 작성 시 반드시 지킬 것:**
1. 시그니처와 요구사항만 작성 (코드 본문 작성 금지)
2. 강한 게이트 설정 (tsc/build/test 중심)
3. 제약사항 명확히 (라이브러리, 스타일, 금지사항)

### Phase 3: 실행 (Claude → Bash)

```bash
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh start "프로젝트 개요: [간단한 설명]"
```

### Phase 4: 모니터링 (Claude)

```bash
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh wait [JOB_DIR]
```

### Phase 5: 게이트 검증 + 선택적 코드 리뷰 (Claude)

```bash
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh results [JOB_DIR]
```

**4단계 검증 프로세스:**

```
Step 0: 의존성 확인 (게이트 실행 전 필수)
  └── node_modules가 없으면: cd [프로젝트] && npm install --silent
  └── tsc/build/test 게이트는 의존성 설치 후에만 유효

Step 1: 자동 게이트 실행 (bash, 토큰 0)
  └── tsc --noEmit → npm run build → npm test → grep 확인

Step 2: 결과 판정
  ├── 전부 통과 → Codex 보고서만 읽기 (토큰 소량)
  └── 실패 있음 → 실패한 게이트 관련 코드만 읽기 (토큰 최소화)

Step 3: 서브태스크 간 인터페이스 확인
  └── 타입/import 경로 등 교차 검증
```

### Phase 5.5: 코드 정리 (선택적, /simplify 활용)

> 게이트가 모두 통과했지만 코드 품질을 한 단계 높이고 싶을 때 사용.

**조건**: Phase 5 게이트 전부 PASS + 태스크 3개 이상일 때 권장

```
Phase 5 게이트 PASS → /simplify 실행 → 게이트 재실행 → Phase 6 통합
```

### Phase 6: 통합 및 수정 (Claude 판단 + Codex 재위임)

**수정이 필요한 경우**: Claude가 직접 고치지 않고 Codex에 재위임.

```
Claude가 하는 일: "뭘 고칠지" 결정 (자연어 수정 지시)
Codex가 하는 일: 실제 수정 실행
```

**수정이 필요 없는 경우**: 서브태스크 간 연결만 확인 후 정리.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh clean [JOB_DIR]
```

> **실행 예시 참고**: `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/examples.md`

---

## 커맨드 레퍼런스

```bash
# 시작
pumasi.sh start [--config path] "프로젝트 컨텍스트"
pumasi.sh start --json "컨텍스트"

# 상태 확인
pumasi.sh status [JOB_DIR]          # JSON
pumasi.sh status --text [JOB_DIR]   # 한 줄 요약
pumasi.sh status --checklist [JOB_DIR]

# 대기
pumasi.sh wait [JOB_DIR]

# 결과
pumasi.sh results [JOB_DIR]
pumasi.sh results --json [JOB_DIR]

# 관리
pumasi.sh stop [JOB_DIR]
pumasi.sh clean [JOB_DIR]
```

---

## 파일 구조

```
${CLAUDE_PLUGIN_ROOT}/
├── pumasi.config.yaml           # 예시 config (직접 수정 금지, 업데이트 시 덮어써짐)
└── skills/pumasi/
    ├── SKILL.md                 # 이 문서
    ├── references/
    │   ├── anti-patterns.md      # 복붙형 instruction 절대 금지
    │   ├── role-separation.md    # Claude vs Codex 역할 경계
    │   ├── codex-guide.md        # Codex 특성 + instruction 규칙
    │   ├── instruction-templates.md # instruction 템플릿 + 좋은/나쁜 예시
    │   ├── tech-stack.md         # 모던 기술스택 추천표
    │   └── examples.md           # 실행 예시 (Todo 앱, 인증 시스템)
    └── scripts/
        ├── pumasi.sh             # 진입점
        ├── pumasi-job.sh         # Node.js 래퍼
        ├── pumasi-job.js         # 오케스트레이터
        └── pumasi-job-worker.js  # Codex 워커 (detached)

프로젝트 디렉토리/
└── .pumasi/
    └── pumasi.config.yaml       # 실제 사용하는 프로젝트별 config (1순위)
```

---

## 주의사항

**순서 의존성 처리**:
태스크 간 의존성이 있으면 **라운드**로 분리:
```
Round 1: 공유 타입/유틸리티 (3개 병렬)
Round 2: Round 1 결과 사용하는 태스크 (2개 병렬)
Round 3: 최종 통합 (Claude 직접)
```

**Codex CLI 필요**:
```bash
command -v codex  # 설치 확인
# 없으면: npm install -g @openai/codex
```

**외주 워커 교체 (선택) — Grok(`grok`) / Cursor(`cursor-agent`) / gajae-code(`gjc`) / Antigravity CLI(`agy`)**:
기본 워커는 Codex지만, task의 `command:` 또는 `defaults.command:`를 바꾸면 다른 CLI로 외주할 수 있다.
프롬프트는 항상 명령의 **마지막 positional 인자**로 자동 전달되므로, 그 형태로 끝나는 명령이면 된다.

**Grok CLI(`grok`)** — xAI Grok Build (코드·대규모 분석):
```yaml
pumasi:
  defaults:
    command: "grok --no-auto-update --no-alt-screen --sandbox workspace --always-approve -p"
```
- 실측(2026-08-23, grok 1.0.4): 비-TTY 파이프에서 stdout 정상 출력 — agy 같은 누락 버그 없음.
- **샌드박스가 기본 off**라 `--sandbox workspace`로 조인다 (codex와 반대 — codex는 기본 샌드박스).
- **자동 업데이터가 백그라운드로 돌므로 `--no-auto-update` 필수.** 넣지 않으면 워커 실행 중 업데이트가 끼어든다.
- codex 전용 `--output-schema/-o` 미주입 → `report.json` 없이 `output.txt` 기반 통합 (graceful).
  grok 자체는 `--json-schema`로 구조화 출력을 지원하지만 결과가 stdout JSON의 `.text`에 **문자열로 중첩**되므로
  codex처럼 파일로 떨어지지 않는다 (언랩 필요 — 현재 미구현).
- 모델은 grok 기본값(`grok-4.6`) 사용. `grok-code-fast-1`은 2026-08-15 폐기되었으므로 쓰지 않는다.
- 인증: `grok login`(구독 세션, `XAI_API_KEY` 불필요) 또는 `XAI_API_KEY` 환경변수.
- ⚠️ **PATH 주의**: `~/.grok/bin/grok`에 설치되고 셸 프로필을 통해 PATH에 들어간다.
  비대화형 셸에서 `command -v grok`이 실패하면 절대경로(`$HOME/.grok/bin/grok`)로 지정한다.
- 설치: `curl -fsSL https://x.ai/cli/install.sh | bash` (원격 스크립트 즉시 실행 — 내용을 먼저 확인하려면 `-o`로 받아서 읽고 실행).

**Cursor CLI(`cursor-agent`)** — Cursor Ultra 구독 워커 (Composer/Codex/Claude 멀티모델):
```yaml
pumasi:
  defaults:
    command: "cursor-agent -p --force --output-format text"
    # 모델 핀 예: "cursor-agent -p --force --model composer-2.5 --output-format text"
```
- **모델 선택이 최대 강점**: `--model`로 `composer-2.5`(빠른 편집), `gpt-5.3-codex-*` 계열,
  **`claude-opus-5-thinking-high` / `claude-fable-5-thinking-high`** 까지 지정 가능 —
  Claude Max 쿼터 소진 시 Cursor 구독으로 Opus/Fable 작업을 잇는 우회 경로가 된다. 목록: `cursor-agent --list-models`.
- 프롬프트는 마지막 positional 인자로 자동 전달(품앗이 규격 그대로). `-p`(print) + `--output-format text` 필수.
- **`--force` 필수** — 없으면 "Do you trust the contents of this directory?"에서 멈춘다(비대화형 즉사).
  CLI 안내대로 `--trust` / `--yolo` / `-f` 중 아무거나면 되고, `--yolo`는 `--force`의 별칭이다.
  (실측 2026-08-27: 신뢰 이력 없는 새 디렉터리에서 `--force`만으로 통과, 없으면 파일 생성 0건으로 정지)
- codex 전용 `--output-schema/-o` 미주입 → `report.json` 없이 `output.txt` 기반 통합 (graceful).
- 실측 E2E(2026-08-27, 2026.08.25 빌드): 워커 2개 동시 실행(하나는 `--model composer-2.5`, 하나는 기본)
  **둘 다 exit 0, 게이트 4/4 통과, 소요 47~59초**, `output.txt` 정상 회수. `report.json`은 예상대로 미생성.
- ⚠️ **훅 충돌 주의**: Orca 등이 `~/.cursor/hooks.json`에 preToolUse 훅을 심어두면 참조 스크립트가 사라졌을 때
  "환경 훅 오류로 파일 생성 차단"으로 전 작업이 실패한다. 워커가 이 에러를 내면 `~/.cursor/hooks.json`을 확인한다.
- 인증: `cursor-agent status`로 확인 (IDE 로그인 공유). 자동화·CI는 `CURSOR_API_KEY` 환경변수.
- 설치: `curl https://cursor.com/install -fsS | bash` → `~/.local/bin/`에 배포된다.
  같은 바이너리가 `agent`라는 이름으로도 심링크되지만, **`agent`는 grok CLI(`~/.grok/bin/agent`)와 이름이 충돌**하므로
  품앗이 config에는 반드시 `cursor-agent`(또는 절대경로)를 쓴다.

**gajae-code(`gjc`)** — 멀티모델 코딩 CLI (`Yeachan-Heo/gajae-code`):
```yaml
pumasi:
  defaults:
    command: "gjc --print"   # 프롬프트가 --print 뒤 positional(MESSAGE)로 자동 전달됨
```
- 모델은 gjc 기본값 사용 (필요 시 `gjc --print --model opus` 등으로 핀).
- codex 전용 `--output-schema/-o` 미주입 → `report.json` 없이 `output.txt` 기반 통합 (graceful).
- 실측(2026-06-19): 비-TTY 파이프에서도 stdout 정상 출력 — agy 같은 누락 버그 없음.
- 설치: https://github.com/Yeachan-Heo/gajae-code

**Antigravity CLI(`agy`)** (디자인/UI):
```yaml
pumasi:
  defaults:
    command: "agy --dangerously-skip-permissions -p"   # 프롬프트는 -p 값으로 자동 전달됨
```
- `agy`는 codex의 `--output-schema/-o`(구조화 보고서)를 지원하지 않는다 → `report.json` 없이 `output.txt` 기반으로만 통합된다.
- `agy` 1.0.x는 비-TTY(파이프)에서 stdout 출력이 누락되는 버그가 있어 `output.txt`가 빌 수 있다. 결과가 비면 Claude가 직접 통합하거나 codex로 폴백한다.
- 모델 지정 플래그(`-m`)는 헤드리스에서 미지원/고정으로 보고됨 → 명령에 넣지 않는다.
- 설치(검증 권장): 스크립트를 받아 **내용을 확인한 뒤** 실행한다.
  ```bash
  curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh
  less /tmp/agy-install.sh        # 무엇을 설치하는지 직접 확인
  bash /tmp/agy-install.sh
  ```
  빠른 설치를 원하면 `curl -fsSL https://antigravity.google/cli/install.sh | bash` (원격 스크립트를 검증 없이 즉시 실행 — 신뢰할 때만).

**task별 혼합**: 모듈마다 다른 `command:`를 지정하면 codex / grok / gjc / agy에 병렬로 나눠 외주할 수 있다.

> ⚠️ **같은 과제를 여러 워커에게 시키는 "토너먼트"는 품앗이의 기능이 아니다.** 품앗이의 본질은 *분할*이고
> 토너먼트는 *중복*이라 "단일 파일 작업 = 병렬 이점 없음" 규칙과 충돌한다. 경쟁·채점·승자 채택이 필요하면
> 끼리끼리(kkirikkiri)의 Workflow 경로를 쓴다. 설계 근거: `docs/design/worker-tournament/01_PRD.md`

> ⚠️ **샌드박스/승인 우회 안내 (opt-in 경계).** 위 provider 설정의 `--dangerously-skip-permissions`(agy) /
> `--sandbox workspace --always-approve`(grok) /
> `--dangerously-bypass-approvals-and-sandbox`(codex)는 워커가 **승인 프롬프트 없이 파일을 쓰도록** 한다 —
> 병렬 외주 자동화를 위해 필요한 동작이다. 따라서 pumasi는 **신뢰하는 본인 레포에서만** 실행하고,
> 외부에서 받은/검토 안 된 코드베이스나 프롬프트에는 쓰지 않는다. `/pumasi` 호출 자체가 이 우회에 대한 명시적 동의이며,
> 우회 없이 돌리려면 provider `command:`에서 해당 플래그를 빼고 codex 기본 샌드박스(`--full-auto` 등)로 교체한다.
