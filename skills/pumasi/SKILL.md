---
name: pumasi
description: Host-controlled parallel coding. Claude Code hosts default to Codex workers; OMO, Codex and other hosts can use Claude Code workers. The host plans, verifies and integrates. Triggers include pumasi, 품앗이, parallel with codex, delegate to codex, Claude worker and 클로드 워커. Image generation belongs to the separate image skill.
---

<!-- Claude-specific first-run setup; never run it from another host -->
**Step 0:** 현재 호스트가 Claude Code일 때만 `bash "${CLAUDE_PLUGIN_ROOT}/setup/setup.sh" >/dev/null 2>&1 || true`를 실행한다. OMO·Codex·기타 호스트는 Claude 설정·훅을 설치하지 않고 아래 호스트 계약부터 따른다.

# 품앗이 (Pumasi) — Codex 병렬 외주 개발

## 호스트와 워커 계약

품앗이를 부른 현재 세션이 항상 **호스트(기획·감독·승인·최종 검증 담당)**다. Claude Code에서 부르면 기본 워커는 Codex이고, OMO·Codex·기타 환경에서 부르면 기본 워커는 Claude Code다. Claude 워커에게 전체 오케스트레이션을 다시 맡기거나 품앗이를 재귀 실행하지 않는다.

- 시작 시 `--host claude-code|omo|codex|other`를 지정한다. 우선순위는 CLI > `PUMASI_HOST` 환경변수 > 설정의 `pumasi.host` > `claude-code`(기존 동작)다.
- 워커 명령 우선순위는 task `command` > 명시한 `defaults.command` > 호스트별 기본값이다. 호스트에 따라 전환하려면 기존 설정의 명시적 Codex `defaults.command`를 생략한다. task별로 명시한 워커를 자동으로 덮어쓰지 않는다.
- Claude 기본 명령은 `claude --print --permission-mode acceptEdits`다. JSON 출력·스키마·stdin 전달은 워커가 관리한다. 모델·허용 도구·권한은 명시적 task/default 명령 옵션으로 조정하며 호스트 인증을 복사하지 않는다.
- 비-Claude 호스트는 이 파일 위치에서 플러그인 루트를 구해 기존 `${CLAUDE_PLUGIN_ROOT}` 자리의 경로로 사용한다. Bash 래퍼가 없어도 `node <plugin>/skills/pumasi/scripts/pumasi-job.js`로 실행할 수 있다.
- AskUserQuestion이 없는 호스트에서는 그 호스트의 질문 도구를 쓰고, 없으면 일반 대화로 선택을 받는다. 이미 명시된 호스트·워커는 다시 묻지 않는다.
- 아래 기존 예시의 **Claude(기획자)**는 호스트, **Codex(구현자)**는 선택된 워커 역할로 읽는다. CLI별 실제 플래그와 인증은 치환하지 않는다. Codex 전용 참고는 Codex 워커에만 적용한다.
- 비-Claude 작업은 기본적으로 호출 프로젝트의 `.pumasi/jobs/`에 저장한다. `start`가 반환한 JOB_DIR를 이후 `wait`, `gates`, `results`, `redelegate`, `stop`에 명시한다. `wait`는 진행 스냅샷도 반환하므로 한 번 돌아왔다고 완료로 보지 않는다. `overallState=done`도 전체 성공을 뜻하지 않으므로 각 워커 상태·보고서·게이트를 확인한다.
- Claude의 실패/부분 완료/잘못된 JSON/누락된 구조화 보고는 완료로 승격하지 않는다. 원본 stdout·stderr와 `report.json`을 보존한 뒤 호스트가 재위임 여부를 판단한다.

상세 실행 예시와 권한 경계: [다른 호스트에서 사용하기](../../docs/host-workers.md).

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
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/anti-patterns.md` — 복붙형 instruction을 피하는 이유와 자가 점검표
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/role-separation.md` — Claude vs Codex 역할 경계, 경계선 예시

**핵심 원칙 요약**: 호스트는 시그니처+요구사항+게이트를 쓰고 코드 본문(body)은 워커에게 맡긴다. 호스트가 본문을 쓰면 외주로 아끼려던 토큰이 그대로 나가기 때문이다. 검증은 강한 게이트(tsc/build/test)로 한다.

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
| 태스크 3~4개 | **품앗이 기본** — 사용자가 지명하지 않아도 제안하고 승인되면 실행 | Codex·Grok 쿼터로 분산, Claude 쿼터 절약 |
| 태스크 5개+ | **품앗이 필수** | 병렬 이득이 확실히 큼 |

**품앗이 vs Claude Code Workflow/worktree**: 품앗이는 구현을 Claude 밖의 쿼터(Codex·Grok·Cursor 등)로 넘길 때 쓴다. 작업 격리와 Claude 수준의 품질이 더 중요하면 Workflow + git worktree(Claude 에이전트)를 쓴다.

**적극 분산 원칙 (2026-11-03 오너 지시)**: 독립 태스크가 3개 이상이면 호스트가 먼저 품앗이를 제안한다. 조사·출처 확인·문서·브라우저 작업은 Grok Bot 팀, 코드 작업은 Codex가 기본이고, 두 갈래가 섞이면 라운드 1 Grok Bot 조사 → 라운드 2 Codex 구현으로 나눈다. 같은 라운드 안의 태스크는 전부 동시에 spawn되며 워커 수 상한은 없다(상한은 각 CLI의 쿼터·429뿐). 30일 실측 품앗이 호출 20회 — 규모가 맞는데 직접 코딩한 경우가 더 많았다.

**다음 경우에는 품앗이가 맞지 않는다:**
- 고칠 위치를 호스트가 좁히지 못한 기존 코드 수정·버그 수정 — 워커에게 넘길 맥락이 너무 커진다. 고칠 파일(`files`)·재현 방법·게이트를 지정할 수 있으면 기존 코드 수정도 맡겨도 된다(Phase 6 재위임이 그 경우다).
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

기획 승인을 받는 같은 질문에 워커 선택을 포함한다. Claude Code에서는 AskUserQuestion을 쓰고, 다른 호스트에서는 위 호스트 계약의 질문 수단을 쓴다.

**스킵 조건**: 사용자가 요청에서 워커를 이미 지명한 경우("grok으로", "codex한테", "agy 외주", "그록봇한테") — 지명된 워커를 그대로 쓰고 묻지 않는다. 프로젝트 `.pumasi/pumasi.config.yaml`에 `defaults.command`나 task별 `command`가 이미 있으면 그것도 지명으로 본다.

문항 구성:
- header: "외주 워커"
- question: "어떤 워커에게 외주를 맡길까요?"
- options (4개):
  1. **호스트 기본 워커 (권장)** — Claude Code 호스트면 Codex, OMO 등 다른 호스트면 Claude Code. 로컬 레포 코드 작업, 구조화 보고(report.json) 지원
  2. **Grok Bot 팀** — Grok Bot 앱의 클라우드 봇 팀(지휘·리서치·브라우저·코딩·검증·정리)에 job으로 맡긴다. 웹 조사·출처 확인·문서·브라우저 작업용이며 로컬 레포를 직접 고치지 않는다. 처음 고르면 Grok Bot 계정에 품앗이 팀 봇 6개·그룹 1개·스킬 1개를 만든다(삭제 없음)
  3. **Antigravity (agy)** — Google Antigravity CLI(Gemini 계열). 디자인·UI·프론트엔드 화면 작업에 강하다. 로컬 레포를 직접 고친다. report.json 없이 output.txt로 통합
  4. **다른 CLI (Grok CLI / Cursor / gjc)** — Grok Build CLI, Cursor의 cursor-agent(여러 계열 모델, Claude 계열 포함 — 목록은 `cursor-agent --list-models`), 멀티모델은 gajae-code(gjc). 고른 뒤 어느 CLI인지 한 번 더 묻는다

선택 결과는 Phase 2에서 `.pumasi/pumasi.config.yaml`의 `defaults.command:`에 반영한다. 사용자가 task마다 다른 워커를 명시했을 때만 task별 `command:`를 쓴다. 각 워커의 정확한 command 문자열은 아래 **"외주 워커"** 표의 것을 그대로 쓴다.

**Grok Bot 팀을 골랐다면(2번) 선택 직후 준비 1회** — `references/workers/grokbot.md`의 준비 절차를 그대로 실행한다. `status`가 앱·세션 없음이면 "Grok Bot 앱에 로그인해 주세요"로 알리고 그 task만 다른 워커로 돌린다.

**선택 직후 설치 확인 1회**: `command -v <cli>` (grok은 실패 시 `$HOME/.grok/bin/grok` 폴백). 미설치·미인증이면 그대로 알리고 중단하거나 사용자에게 다른 워커를 선택받는다. 명시한 Claude 워커를 Codex로 몰래 바꾸지 않는다.

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
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/codex-guide.md` — 워커 instruction에 넣을 것·뺄 것, 라이브러리 대체 방지
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/instruction-templates.md` — 템플릿, 좋은/나쁜 예시, 자기 점검 체크리스트
> - `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/references/tech-stack.md` — 버전 고르는 원칙(프로젝트 기존 버전 우선)

**task 필드**: `instruction`(목표), `gates`(완료 기준 명령), 선택으로 `files`(고칠 파일 목록)·`read_only`(읽기만 할 파일 목록). 워커 프롬프트는 목표 → 맥락 → 대상 파일 → 완료 기준(gates 명령 전문) → 경계 → 보고 형식 순서로 만들어진다. 워커가 게이트 명령을 직접 돌려 보고 끝내므로, 게이트는 작업 디렉토리에서 그대로 실행되는 명령으로 쓴다.

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

구조화 리포트와 상태를 먼저 확인할 때는 `results --compact [JOB_DIR]`를 쓸 수 있다. 원문 프롬프트·stdout·stderr를 중복 출력하지 않고 리포트·게이트 결과와 원본 파일 경로를 반환한다. 실패·부분 완료·리포트 누락을 조사할 때는 해당 원본 파일도 읽는다. 기본 출력과 `--json`의 기존 동작은 유지된다.

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

동일 소스 스냅샷에 대한 **결정론적·읽기 전용 공통 검사**만 gate 항목에 `shared_readonly: true`를 명시할 수 있다. 모든 워커가 완료된 한 번의 `gates` 호출 안에서 같은 작업 디렉터리·명령의 통과 결과만 공유한다. 일반 검사, 실패·타임아웃, 작업 디렉터리가 다른 검사에는 적용하지 않는다. 일반 검사가 사이에 실행되면 공유 결과를 폐기하고, 다음 `gates` 호출에서는 항상 다시 검사한다. 포맷터·스냅샷 갱신·외부 서비스·시각이나 실행 순서에 의존하는 검사에는 표시하지 않는다. 검사 중 다른 프로세스가 소스를 수정할 수 있는 상황에서도 사용하지 않는다.

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
pumasi.sh results --compact [JOB_DIR]

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
    │   ├── anti-patterns.md      # 복붙형 instruction을 피하는 이유
    │   ├── role-separation.md    # Claude vs Codex 역할 경계
    │   ├── codex-guide.md        # 워커 instruction 작성 요령
    │   ├── instruction-templates.md # instruction 템플릿 + 좋은/나쁜 예시
    │   ├── tech-stack.md         # 버전 고르는 원칙
    │   ├── workers/              # 워커 CLI별 설치·플래그·실측 이력
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

**단계형 실행 (결과를 보고 다음 라운드를 정한다)** — 조사→구현처럼 앞 결과가 뒤 지시를 바꾸는 작업에 기본으로 쓴다(예: 라운드 1 Grok Bot 조사 → 라운드 2 Codex 구현).
1. `start`는 라운드 1만 띄운다. 라운드 2 이후 task는 config에 미리 적어 두되 지시는 "앞 라운드 결과와 호스트 결정을 따른다" 수준으로 둔다.
2. 라운드 1이 끝나면 호스트가 결과(`results --compact`, 회수된 `SUMMARY.md`)와 게이트를 읽고 **결론을 정한다** — 채택할 규칙·버릴 가정·남은 미확인.
3. `pumasi.sh start-round --round 2 --note "<결론 3~6줄>" <JOB_DIR>`로 다음 라운드를 띄운다. 워커 프롬프트에는 앞 라운드 결과(보고서 요약 또는 output 앞 2000자)와 `## 호스트 결정` 블록이 함께 들어가고, 결정문은 `job.json`의 `roundNotes`에 남는다.
4. 라운드 1 결과가 부족하면 다음 라운드로 넘어가지 말고 `redelegate --correction`으로 그 task를 다시 시키거나 사용자에게 보고한다. partial을 그대로 넘기지 않는다.

같은 라운드 안의 task는 계속 병렬이다. 앞 결과에 기대지 않는 task까지 라운드를 나누면 느려지기만 하니 의존이 있을 때만 나눈다.

**후보 경쟁 (`candidates`)** — 정답을 기계로 판정할 수 없는 task에만: 조사 방향·이름 짓기·문구·설계안·구조 초안.
게이트가 강한 코드 task(테스트·타입 체크로 판정되는 것)에는 쓰지 않는다 — 둘 다 통과해 고를 의미가 없고 비용만 두 배다(2026-08 codex·grok 비교 실측).

```yaml
    - name: naming
      candidates: 2                    # 2~3. 최대 3
      candidate_commands:              # 선택: 후보마다 다른 워커. 없으면 command 를 같이 쓴다
        - "codex exec --dangerously-bypass-approvals-and-sandbox"
        - "node /abs/grokbot.mjs run --text --queue --timeout 1500 --dest .pumasi/grokbot/naming-c2"
      instruction: |
        서비스 이름 후보 10개와 각각의 근거를 docs/naming.md 로 쓴다 ...
      gates:
        - name: "결과 존재"
          command: "ls docs/naming-c*.md >/dev/null 2>&1 || ls .pumasi/grokbot/naming-c*/SUMMARY.md >/dev/null 2>&1"
```

- 펼치면 `naming~c1`, `naming~c2` 두 task가 같은 라운드에서 병렬로 돈다. 지시 끝에 "후보 i/N, 산출물 이름에 `-c<i>`, 다른 후보 파일 금지, 분명한 접근 하나를 끝까지"가 자동으로 붙는다.
- 게이트는 후보마다 따로 돈다. 후보별 파일 이름(`-c1`, `-c2`)으로 확인하게 쓴다.
- **고르기(호스트)**: 둘 다 끝나면 호스트가 기준표를 먼저 쓰고(3~5개 기준, 예: 요구 충족·근거·차별성·실행 가능성) 후보를 같은 기준으로 비교해 하나를 고른다. 채택 이유와 버린 후보의 쓸 만한 점을 한 줄씩 남긴다. 합치기는 기본으로 하지 않는다 — 필요하면 다음 라운드 task로 "채택안 + 버린 후보의 X만 반영"을 맡긴다.
- 사용자가 직접 고르겠다고 했으면 AskUserQuestion으로 후보 요약을 선택지로 보여 준다(후보 2~3개 + "다시 생성").
- Grok Bot 후보는 지휘 봇이 job을 하나씩 받아 `--queue`로 차례를 기다린다(실제로는 순차). 주간 사용량이 있으니 Grok Bot 후보는 1개까지로 둔다.

**외주 워커** — 호스트별 기본 워커(Claude Code 호스트는 Codex, 다른 호스트는 Claude) 대신 task의 `command:` 또는 `defaults.command:`로 다른 CLI를 지정할 수 있다. Claude Code 워커는 stdin으로 프롬프트를 받아 구조화 JSON을 돌려주고, 나머지 CLI는 프롬프트를 **마지막 positional 인자**로 받는다. 아래 command 문자열을 그대로 쓰고, 설치·인증·플래그 이유·실측 이력은 각 상세 파일을 본다.

| 워커 | command | 상세 |
|------|---------|------|
| Codex | `codex exec --dangerously-bypass-approvals-and-sandbox` | `references/workers/codex.md` |
| Grok CLI | `grok --no-auto-update --no-alt-screen --sandbox workspace --always-approve -p` | `references/workers/grok.md` |
| Cursor | `cursor-agent -p --force --output-format text` | `references/workers/cursor.md` |
| gajae-code | `gjc --print` | `references/workers/gjc.md` |
| Antigravity | `agy --dangerously-skip-permissions -p` | `references/workers/agy.md` |
| Grok Bot 팀 | `node /abs/path/to/grokbot.mjs run --text --queue --partial-ok --timeout 3000 --dest .pumasi/grokbot/<task>` | `references/workers/grokbot.md` (준비 절차 포함) |

- 모델 이름은 문서에 고정하지 않는다. 핀이 필요하면 각 CLI의 `--list-models`(예: `cursor-agent --list-models`)나 설정·도움말로 현재 이름을 확인해 command에 넣는다.
- Codex·Claude 워커만 `report.json`(구조화 보고)을 만든다. 나머지는 `output.txt`로 통합한다.

**task별 워커 지정**: 워커 선택지에는 없지만, 사용자가 원하면 task마다 다른 `command:`를 지정해 codex / grok / gjc / agy / grokbot에 나눠 맡길 수 있다.

> ⚠️ **같은 과제를 여러 워커에게 시키는 "토너먼트"는 품앗이의 기능이 아니다.** 품앗이의 본질은 *분할*이고
> 토너먼트는 *중복*이라 "단일 파일 작업 = 병렬 이점 없음" 규칙과 충돌한다. 경쟁·채점·승자 채택이 필요하면
> 끼리끼리(kkirikkiri)의 Workflow 경로를 쓴다. 설계 근거: `docs/design/worker-tournament/01_PRD.md`

> ⚠️ **샌드박스/승인 우회 안내 (opt-in 경계).** 위 provider 설정의 `--dangerously-skip-permissions`(agy) /
> `--sandbox workspace --always-approve`(grok) /
> `--dangerously-bypass-approvals-and-sandbox`(codex)는 워커가 **승인 프롬프트 없이 파일을 쓰도록** 한다 —
> 병렬 외주 자동화를 위해 필요한 동작이다. 따라서 pumasi는 **신뢰하는 본인 레포에서만** 실행하고,
> 외부에서 받은/검토 안 된 코드베이스나 프롬프트에는 쓰지 않는다. `/pumasi` 호출 자체가 이 우회에 대한 명시적 동의이며,
> 우회 없이 돌리려면 provider `command:`에서 해당 플래그를 빼고 codex 기본 샌드박스(`--full-auto` 등)로 교체한다.
