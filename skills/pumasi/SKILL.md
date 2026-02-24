---
name: pumasi
description: Codex CLI를 병렬 외주 개발자로 활용하는 스킬. "/pumasi", "품앗이로 만들어줘", "품앗이 켜줘", "codex 외주로", "codex한테 시켜" 같은 요청에 사용됩니다. 3개 이상의 독립 모듈을 동시에 만들어야 할 때 자동 감지됩니다.
---

# 품앗이 (Pumasi) — Codex 병렬 외주 개발

> 품앗이: 서로 협력하며 일을 나눠 하는 한국 전통 방식
> Claude = 기획/감독/PM | Codex x N = 병렬 외주 개발자

## 개념

```
┌─────────────────────────────────────────────────────────┐
│              Claude Code (기획/감독/PM)                  │
│  1. 요구사항 분석 → 독립 서브태스크 분해                  │
│  2. pumasi.config.yaml에 작업 목록 작성                   │
│  3. pumasi.sh 실행 → Codex 병렬 스폰                     │
│  4. 결과물 검토 → 수정·통합                              │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ Codex #1 │     │ Codex #2 │     │ Codex #3 │
  │ 독립 구현 │     │ 독립 구현 │     │ 독립 구현 │
  └──────────┘     └──────────┘     └──────────┘
        │                 │                 │
        └─────────────────┴─────────────────┘
                          │
              Claude Code 검토 → 통합 → 완성
```

## 품앗이 모드란

**품앗이 모드 = Claude는 PM/검증자, Codex는 구현자**

| 역할 | 담당 | 토큰 |
|------|------|------|
| PM 기획, 태스크 분해 | Claude Code | 소량 |
| instruction + 동적 게이트 작성 | Claude Code | 중간 |
| 코드 생성, 파일 작성 | Codex (병렬) | Codex 토큰 |
| 동적 게이트 실행 (bash) | Claude Code | **0** (bash) |
| 게이트 통과 시 보고서 확인 | Claude Code | **소량** |
| 게이트 실패 시 해당 코드만 리뷰 | Claude Code | 최소 |
| 수정 필요 시 재위임 | Codex | Codex 토큰 |

> **핵심 가치 = 병렬 처리로 속도 향상 (N개 모듈 동시 구현)**
> **검증 최적화 = 동적 게이트(토큰 0) + 선택적 코드 리뷰**

---

## 7단계 워크플로우

### Phase 0: 기획 (Claude as PM)

사용자 요청을 분석하여 **완성도 있는 기획안** 작성. "이 앱이라면 당연히 있어야 할 기능"을 스스로 설계하여 포함시킨다.

기획 체크리스트:
```
□ 이 앱/기능의 핵심 사용 시나리오는?
□ 경쟁 제품/일반적 기대치 대비 빠진 기능은?
□ 데이터 모델에 필요한 필드가 충분한가?
□ UX 관점: 검색, 정렬, 필터, 벌크 작업이 필요한가?
□ 비기능 요구사항: 반응형, 다크모드, 키보드 접근성은?
```

기획안을 사용자에게 제시 후 승인받고 진행.

### Phase 1: 분석 (Claude)

요청을 **독립적으로 병렬 실행 가능한** 서브태스크로 분해.

**좋은 서브태스크 조건**:
- 다른 서브태스크 완료를 기다리지 않아도 됨
- 명확한 입출력 정의 가능
- Codex 혼자 30분~2시간 내 완성 가능한 범위
- 파일/기능 경계가 명확함

순서 의존성이 있으면 **라운드**로 분리:
```
Round 1: 공유 유틸리티/모델 (3개 병렬)
Round 2: 앞 라운드 결과 사용하는 태스크 (2개 병렬)
Round 3: 최종 통합 (Claude 직접)
```

### Phase 2: 설정 (Claude)

`${CLAUDE_PLUGIN_ROOT}/pumasi.config.yaml`의 `tasks:` 섹션을 수정:

```yaml
pumasi:
  tasks:
    - name: token-utils
      instruction: |
        다음 파일을 구현하세요: src/auth/token.ts
        요구사항:
        - JWT 토큰 생성 함수: generateToken(userId, role) → string
        - JWT 토큰 검증 함수: verifyToken(token) → {userId, role} | null
        완료 후 반드시 보고: 구현한 함수 시그니처, 주요 결정사항

      gates:
        - name: "파일 존재"
          command: "ls src/auth/token.ts"
        - name: "타입 체크"
          command: "npx tsc --noEmit src/auth/token.ts"
        - name: "함수 시그니처 확인"
          command: "grep -q 'generateToken' src/auth/token.ts && grep -q 'verifyToken' src/auth/token.ts"
```

### Phase 3: 실행 (Claude → Bash)

```bash
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh start "프로젝트 개요: [간단한 설명]"
```

Job 디렉토리 경로가 출력됨.

### Phase 4: 모니터링 (Claude)

```bash
# 진행상황 확인 (완료 대기)
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh wait [JOB_DIR]
# 또는 텍스트 상태 확인
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh status --text [JOB_DIR]
```

wait 명령은 의미 있는 상태 변화가 생길 때까지 블로킹. 완료 시 JSON 반환.

### Phase 5: 동적 게이트 + 선택적 코드 리뷰 (Claude)

```bash
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh results [JOB_DIR]
```

**3단계 검증 프로세스:**

```
Step 1: 자동 게이트 실행 (bash, 토큰 0)
  └── pumasi.config.yaml의 각 태스크 gates를 순서대로 실행

Step 2: 결과 판정
  ├── 전부 통과 → Codex 보고서만 읽기 (토큰 소량)
  └── 실패 있음 → 실패한 게이트 관련 코드만 읽기 (토큰 최소화)

Step 3: 서브태스크 간 인터페이스 확인
  └── 타입/import 경로/포트 번호 등 교차 검증
```

**게이트 유형 참고:**

| 태스크 유형 | 게이트 예시 |
|------------|-----------|
| 백엔드 API | 파일 존재, tsc --noEmit, 라이브러리 grep, 포트 확인 |
| 프론트엔드 UI | 파일 존재, npm run build, React/Tailwind 버전 grep |
| 유틸리티 | 파일 존재, tsc --noEmit, export 함수 grep |
| DB/스키마 | 파일 존재, 테이블/컬럼 grep, 라이브러리 확인 |
| 설정 파일 | 파일 존재, JSON 파싱 (node -e), 버전 grep |

### Phase 6: 통합 및 수정 (Claude 판단 + Codex 재위임)

**수정이 필요한 경우**: Claude가 직접 고치지 않고 Codex에 재위임.

```
Claude가 하는 일: "뭘 고칠지" 결정 (구체적 수정 지시 작성)
Codex가 하는 일: 실제 수정 실행
```

**수정이 필요 없는 경우**: 서브태스크 간 연결만 확인 후 정리.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/pumasi.sh clean [JOB_DIR]
```

---

## Codex에게 효과적인 instruction 규칙

Codex는 맥락을 추론하지 않는다. 모든 것을 명시해야 한다.

```
DO (반드시):
- 절대 경로로 파일 위치 명시
- 함수/클래스 시그니처를 코드 블록으로 정의
- 사용할 라이브러리의 import 문을 직접 작성해서 제공
- 초기화/설정 코드 보일러플레이트를 포함
- import 경로와 export 형태 지정
- 생성할 파일 목록을 명확히 나열
- package.json, tsconfig.json 등 설정 파일 내용을 그대로 제공

DON'T (금지):
- "적절한 라이브러리를 골라서" → 어떤 라이브러리인지 모름
- "깔끔하게 구현해줘" → 기준이 없음
- "나머지는 알아서" → 알아서 못함
- 함수 시그니처 없이 "CRUD 구현" → 필드명, 타입 다 다르게 만듦
```

## 모던 기술스택 기본 원칙 (2025-2026)

| 영역 | 추천 (최신) | 피해야 할 것 |
|------|------------|-------------|
| 프론트엔드 | React 19, Vue 3.5+, Svelte 5 | React 18 이하 |
| 빌드 | Vite 6+, Turbopack | Vite 5 이하, Webpack |
| CSS | Tailwind 4, CSS Modules | Tailwind 3 이하 |
| 백엔드 | Hono, Elysia, Express 5 | Express 4 |
| 런타임 | Bun, Node 22+ | Node 18 이하 |
| ORM/DB | Drizzle ORM, better-sqlite3 | Sequelize, TypeORM |
| TypeScript | 5.8+ | 5.3 이하 |
| 패키지매니저 | bun, pnpm | npm (가능하면) |
| 테스트 | Vitest | Jest (Vite 프로젝트에서) |

---

## 커맨드 레퍼런스

```bash
# 시작
pumasi.sh start [--config path] "프로젝트 컨텍스트"
pumasi.sh start --json "컨텍스트"

# 상태 확인
pumasi.sh status [JOB_DIR]
pumasi.sh status --text [JOB_DIR]
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

Scripts are located at `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/`.

---

## 파일 구조

```
${CLAUDE_PLUGIN_ROOT}/
├── commands/pumasi.md          # 라우터 커맨드
├── skills/pumasi/
│   ├── SKILL.md                # 이 문서
│   └── scripts/
│       ├── pumasi.sh           # 진입점
│       ├── pumasi-job.sh       # Node.js 래퍼
│       ├── pumasi-job.js       # 오케스트레이터
│       └── pumasi-job-worker.js # Codex 워커 (detached)
├── pumasi.config.yaml          # 작업 목록 (매 실행 전 수정)
└── .jobs/                      # 실행 결과 (런타임 생성)
```

## 주의사항

**Codex CLI 필요**:
```bash
which codex  # 설치 확인
# 없으면: npm install -g @openai/codex
```

**yaml 의존성 필요**:
```bash
cd ${CLAUDE_PLUGIN_ROOT}/skills/pumasi && npm install yaml
```
