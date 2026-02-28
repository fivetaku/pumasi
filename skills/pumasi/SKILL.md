---
name: pumasi
description: Claude가 큰 그림을 설계하고 Codex를 병렬 외주 개발자로 활용하는 스킬. 독립적인 서브태스크를 Codex에 분배하여 동시 구현 후 Claude가 검토·통합한다.
---

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

## ⚠️ 안티패턴: 복붙형 instruction (절대 금지)

> **이 섹션은 품앗이의 가장 중요한 규칙이다. 반드시 숙지하라.**

다음 패턴이 발견되면 품앗이의 가치가 완전히 사라진다:

```
❌ 절대 금지:
- instruction에 완성된 함수/컴포넌트 코드 블록 포함
- "위 코드를 그대로 작성하세요" 패턴
- Claude가 구현을 다 한 후 Codex에게 파일 저장만 시키는 것
- JSX/HTML 마크업을 instruction에 직접 작성
- 비즈니스 로직을 코드로 제공

이런 패턴이면 Claude가 이미 토큰을 소비한 것이고,
Codex는 단순 파일 저장 도구로 전락한다.
차라리 Claude가 Write 도구로 직접 쓰는 것이 더 효율적이다.
```

### 왜 이런 실수가 발생하는가?

1. Claude(LLM)는 "과잉 친절" 성향이 있어 코드를 끝까지 완성하려 함
2. "모든 것을 명시하라"를 "구현까지 다 써라"로 오해
3. 게이트가 약하면(ls/grep만) Claude가 불안해서 코드를 다 써버림
4. **해결: 시그니처+요구사항만 작성하고, 강한 게이트(tsc/build/test)로 검증**

---

## Claude vs Codex 역할 분리 (핵심)

### Claude가 제공하는 것 (instruction에 포함)

```
✅ 타입/인터페이스 정의 (body 없이)
✅ 함수/클래스 시그니처 (body 없이)
✅ 요구사항 (자연어, 구체적)
✅ 제약사항 (라이브러리명, 스타일 규칙, 금지사항)
✅ 필수 import 라인 (라이브러리 강제용, 1~2줄)
✅ 데이터 모델/스키마 정의
✅ 기존 코드 참조 경로 (reference_files)
✅ 프로젝트 컨텍스트 (기술 스택, 디렉토리 구조)
```

### Codex가 구현하는 것 (Claude가 작성 금지)

```
❌ 함수/메서드 본문 (body)
❌ 컴포넌트 렌더링 로직 (JSX/HTML)
❌ 비즈니스 로직 구현
❌ CSS/스타일 코드
❌ 이벤트 핸들러 구현
❌ API 호출 로직
❌ 데이터 변환/처리 로직
```

### 경계선 예시

```
Claude가 주는 것:
  export function generateToken(userId: string, role: string): string
  - jsonwebtoken 사용 (필수 import: import jwt from 'jsonwebtoken')
  - 만료: 7일
  - secret: process.env.JWT_SECRET

Codex가 구현하는 것:
  export function generateToken(userId: string, role: string): string {
    return jwt.sign({ userId, role }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  }
```

Claude는 **위쪽만** 작성한다. 아래쪽은 Codex가 채운다.

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

### 품앗이 모드 진입 시 Claude의 행동 변화

```
일반 모드:          품앗이 모드:
Claude가 직접 코딩  Claude가 시그니처+요구사항 작성
                   → pumasi.sh 실행 → Codex가 구현
                   → 게이트 자동 검증 → 통합
```

---

## PM 기획 원칙 (Phase 0)

> **Claude는 단순 대행자가 아니라 PM이다. 사용자의 요청을 그대로 전달하지 않고, "이 앱이라면 당연히 있어야 할 기능"을 스스로 설계하여 포함시킨다.**

### 기획 체크리스트

태스크 분해 **전에** 반드시 다음을 확인:

```
□ 이 앱/기능의 핵심 사용 시나리오는?
□ 경쟁 제품/일반적 기대치 대비 빠진 기능은?
□ 데이터 모델에 필요한 필드가 충분한가?
□ UX 관점: 검색, 정렬, 필터, 벌크 작업이 필요한가?
□ 비기능 요구사항: 반응형, 다크모드, 접근성은?
□ 태스크 수가 4개 이상인가? (아니면 Claude 직접 코딩)
```

### PM 기획 워크플로우

```
사용자 요청 수신
       │
       ▼
┌─────────────────────────────┐
│  규모 판단                    │
│  태스크 < 4 → Claude 직접    │
│  태스크 ≥ 4 → 품앗이 모드    │
└─────────────────────────────┘
       │ (품앗이)
       ▼
┌─────────────────────────────┐
│  Phase 0: PM 기획            │
│  1. 앱 유형 파악             │
│  2. 필요 기능 자체 리스트업   │
│  3. 데이터 모델 설계         │
│  4. 기획안 사용자에게 제시    │
│  5. 승인 후 Phase 1 진행     │
└─────────────────────────────┘
```

### 데이터 모델 설계 원칙

Codex에게 보내기 전에 Claude가 **데이터 모델을 충분히 설계**해야 한다.
(데이터 모델은 시그니처/타입이므로 Claude가 작성하는 것이 맞음)

```typescript
// Claude가 설계하는 것 (타입 정의 = OK)
interface Todo {
  id: string
  title: string
  description?: string
  completed: boolean
  priority: 'high' | 'medium' | 'low'
  dueDate?: string
  category?: string
  tags: string[]
  order: number
  createdAt: string
  updatedAt: string
}
```

**원칙: 타입/인터페이스는 Claude가 설계. 구현 로직은 Codex가 작성.**

---

## 7단계 워크플로우

### Phase 0: 기획 (Claude as PM)

사용자 요청을 분석하여 **완성도 있는 기획안**을 작성. 기획 체크리스트 통과 후 사용자 승인을 받는다.

### Phase 1: 분석 (Claude)

요청을 받으면 **독립적으로 병렬 실행 가능한** 서브태스크로 분해.

**좋은 서브태스크 조건**:
- 다른 서브태스크 완료를 기다리지 않아도 됨
- 명확한 입출력(시그니처) 정의 가능
- Codex 혼자 구현 가능한 범위
- 파일/기능 경계가 명확함

**적정 분해 예시** (인증 시스템):
```
Round 1 (병렬):
  task1: JWT 토큰 유틸리티 (auth/token.ts)
  task2: 비밀번호 해싱 유틸리티 (auth/password.ts)
  task3: 사용자 모델 + DB 스키마 (models/user.ts)
Round 2 (후속):
  task4: 인증 API 엔드포인트 (routes/auth.ts) ← task1,2,3 완료 후
```

### Phase 2: 설정 (Claude)

`pumasi.config.yaml`의 `tasks:` 섹션을 수정.

**instruction 작성 시 반드시 지킬 것:**
1. 시그니처와 요구사항만 작성 (코드 본문 작성 금지)
2. 강한 게이트 설정 (tsc/build/test 중심)
3. 제약사항 명확히 (라이브러리, 스타일, 금지사항)

```yaml
pumasi:
  tasks:
    - name: token-utils
      instruction: |
        src/auth/token.ts를 구현하세요.

        ## 시그니처
        export function generateToken(userId: string, role: string): string
        export function verifyToken(token: string): { userId: string; role: string } | null

        ## 요구사항
        - jsonwebtoken 라이브러리 사용 (다른 라이브러리로 대체 금지)
        - 필수 import: import jwt from 'jsonwebtoken'
        - 만료 시간: 7일
        - secret: process.env.JWT_SECRET
        - verifyToken은 만료/무효 토큰에 null 반환

        ## 제약사항
        - TypeScript strict mode, ESM
        - 에러 시 throw 대신 null 반환

      gates:
        - name: "타입 체크"
          command: "npx tsc --noEmit src/auth/token.ts"
        - name: "라이브러리 확인"
          command: "grep -q 'jsonwebtoken' src/auth/token.ts"
        - name: "시그니처 확인"
          command: "grep -q 'generateToken' src/auth/token.ts && grep -q 'verifyToken' src/auth/token.ts"
```

### Phase 3: 실행 (Claude → Bash)

```bash
~/.claude/skills/pumasi/scripts/pumasi.sh start "프로젝트 개요: [간단한 설명]"
```

### Phase 4: 모니터링 (Claude)

```bash
~/.claude/skills/pumasi/scripts/pumasi.sh wait [JOB_DIR]
```

### Phase 5: 게이트 검증 + 선택적 코드 리뷰 (Claude)

```bash
~/.claude/skills/pumasi/scripts/pumasi.sh results [JOB_DIR]
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

**게이트 설계 원칙:**

> **게이트가 강하면 Claude가 코드를 쓸 필요가 없다.**
> tsc/build/test가 통과했다면 구현이 올바른 것이다.

**게이트 작성 시 셸 호환성 주의:**

```
❌ test -f file.ts       # 일부 셸에서 alias/function에 의해 간섭될 수 있음
✅ [ -f file.ts ]        # POSIX 브래킷 문법, alias 간섭 없음

❌ ls file.ts             # 출력이 장황함
✅ [ -f file.ts ]        # 깔끔한 exit code만 반환
```

**게이트 우선순위 (필수 → 권장):**

| 우선순위 | 게이트 | 검증 대상 |
|---------|--------|----------|
| **필수** | `npx tsc --noEmit` | 타입 안전성 |
| **필수** | `npm run build` (있으면) | 빌드 성공 |
| 권장 | `npm test -- --run` (있으면) | 기능 동작 |
| 권장 | `grep -q '라이브러리명'` | 지정 라이브러리 사용 |
| 선택 | `[ -f [파일경로] ]` | 파일 존재 |

**게이트 유형 참고 (태스크 유형별):**

| 태스크 유형 | 권장 게이트 |
|------------|-----------|
| 백엔드 API | tsc --noEmit, 라이브러리 grep, 시그니처 grep |
| 프론트엔드 UI | npm run build, 컴포넌트명 grep |
| 유틸리티 | tsc --noEmit, export 함수 grep |
| DB/스키마 | tsc --noEmit, 테이블/컬럼 grep |
| 풀스택 | npm run build, npm test |

### Phase 6: 통합 및 수정 (Claude 판단 + Codex 재위임)

**수정이 필요한 경우**: Claude가 직접 고치지 않고 Codex에 재위임.

```
Claude가 하는 일: "뭘 고칠지" 결정 (자연어 수정 지시)
Codex가 하는 일: 실제 수정 실행
```

**수정이 필요 없는 경우**: 서브태스크 간 연결만 확인 후 정리.

```bash
~/.claude/skills/pumasi/scripts/pumasi.sh clean [JOB_DIR]
```

---

## Codex 특성

> **Codex는 Claude와 달리 맥락 추론이 약하다. 하지만 구현력은 충분하다.**
> **핵심: 무엇을(시그니처)과 어떻게(제약사항)를 명확히 주면 잘 구현한다.**

### Claude vs Codex

| 항목 | Claude | Codex |
|------|--------|-------|
| 맥락 추론 | 잘함 | 약함 |
| 코드 구현 | 할 수 있지만 토큰 비쌈 | **빠르고 사용량 넉넉** |
| 파일 경로 | 상대경로 OK | **절대경로 필수** |
| 라이브러리 | 추천 가능 | **지정 필수** (안 하면 대체함) |
| 함수 시그니처 | 자유 설계 | **정확히 지정 필수** |

### Codex가 라이브러리를 대체하는 문제

"better-sqlite3 사용"이라고만 쓰면 Codex가 더 쉬운 방법(JSON 파일 등)으로 대체할 수 있다.

**해결 방법 (코드 전체를 주지 않고):**

```
❌ 나쁜 해결 (코드 전체 제공 — 안티패턴):
  instruction에 DB 초기화 코드 30줄을 그대로 작성

✅ 좋은 해결 (제약사항 + 게이트 강화):
  instruction:
    - 라이브러리: better-sqlite3 (JSON/fs 등 다른 방식 사용 절대 금지)
    - 필수 import: import Database from 'better-sqlite3'
    - DB 파일: ./data.db

  gates:
    - name: "better-sqlite3 사용 확인"
      command: "grep -q 'better-sqlite3' src/db.ts && ! grep -q 'readFileSync' src/db.ts"
    - name: "타입 체크"
      command: "npx tsc --noEmit src/db.ts"
```

**원칙: 코드를 주지 말고, 제약사항을 주고 게이트로 검증하라.**

### Codex에게 효과적인 instruction 규칙

```
✅ DO (Claude가 instruction에 포함할 것):
- 절대 경로로 파일 위치 명시
- 함수/클래스 시그니처 (body 없이)
- 타입/인터페이스 정의
- 사용할 라이브러리명 + 필수 import 1줄
- 자연어 요구사항 (구체적으로)
- 금지사항 (다른 라이브러리 대체 금지 등)
- 생성할 파일 목록
- 코딩 스타일 (ESM/CJS, strict mode 등)

❌ DON'T (Claude가 instruction에 포함하지 말 것):
- 함수/컴포넌트의 본문(body) 코드
- JSX/HTML 렌더링 마크업
- 비즈니스 로직 구현 코드
- CSS/스타일 구현 코드
- "위 코드를 그대로 작성하세요" 지시
- 10줄 이상의 코드 블록
- 설정 파일 전체 내용 (핵심 설정값만 전달)
```

---

## instruction 템플릿

```
{절대경로}에 다음 파일들을 구현하세요.

## 프로젝트 컨텍스트
- 기술 스택: {언어, 프레임워크, 버전}
- 스타일: {ESM/CJS, strict mode 등}
- 패키지 매니저: {bun/pnpm/npm}

## 생성할 파일 목록
- {경로1} — {역할}
- {경로2} — {역할}

## 공통 타입 (다른 서브태스크와 공유)
```typescript
// 타입/인터페이스만 (body 없이)
interface SharedType { ... }
```

## 파일별 상세

### {경로1}
역할: {이 파일의 역할}

시그니처:
```typescript
export function functionName(param: Type): ReturnType
export class ClassName {
  method(param: Type): ReturnType
}
```

요구사항:
- {구체적 동작 1 — 자연어로}
- {구체적 동작 2 — 자연어로}
- 라이브러리: {이름} (필수 import: {import 문 1줄})

## 금지사항
- 위에 정의되지 않은 파일 생성 금지
- 함수 시그니처 변경 금지
- 지정되지 않은 라이브러리 사용 금지

## 완료 보고
구현 완료 후 다음을 보고하세요:
- 생성된 파일 경로 목록
- 각 함수/클래스의 실제 구현 방식 요약
- 주요 설계 결정사항
```

### 좋은 instruction vs 나쁜 instruction

```
❌ 나쁜 instruction (Claude가 코드를 다 씀):
  instruction: |
    IndexCard.tsx를 구현하세요.
    ```tsx
    export default function IndexCard({ value, change }: Props) {
      const isPositive = change >= 0
      const color = isPositive ? 'text-green-400' : 'text-red-400'
      return (
        <div className="bg-gray-900 rounded-lg p-6">
          <span className="text-4xl">{value.toFixed(1)}</span>
          <span className={color}>{change}</span>
        </div>
      )
    }
    ```
    위 코드를 그대로 작성하세요.

→ Claude가 이미 토큰을 다 소비함. Codex는 복사만.

✅ 좋은 instruction (Codex가 구현함):
  instruction: |
    src/components/dashboard/IndexCard.tsx를 구현하세요.

    시그니처:
    interface IndexCardProps { value: number; change: number; changePct: number }
    export default function IndexCard(props: IndexCardProps): JSX.Element

    요구사항:
    - 영향력 지수를 크게 표시 (text-4xl 정도)
    - change가 양수면 녹색 ▲, 음수면 빨간색 ▼ 표시
    - changePct를 소수 2자리로 표시
    - Tailwind CSS, 다크 테마 (bg-gray-900 기반)
    - 스케일 안내 텍스트: "0~1000 스케일 | 가중 기하평균 기반"

→ Claude 토큰 소량. Codex가 실제 구현.
```

---

## 실행 예시

### 예시: Todo 앱 (PM 기획 포함)

```
사용자: "품앗이로 Todo 앱 만들어줘"

[Phase 0] Claude PM 기획:
→ 기능 설계 + 데이터 모델 + 기획안 → 사용자 승인

[Phase 1] Claude 태스크 분해:
Round 1 (병렬):
  - task1: 백엔드 DB + API
    → 시그니처: createTodo(), getTodos(), updateTodo(), deleteTodo()
    → 라이브러리: better-sqlite3, Hono
    → Todo 타입 정의 제공
  - task2: 프론트엔드 컴포넌트
    → 시그니처: TodoItem, AddTodo, FilterBar, StatsBar
    → 요구사항: 인라인 수정, 우선순위 색상, 검색
  - task3: 프론트엔드 설정 + 공통 유틸리티
    → Vite + React 19 + Tailwind 4 설정
    → 공통 fetch 래퍼, 타입 export
Round 2 (후속):
  - task4: 캘린더 뷰 + 드래그 앤 드롭

[Phase 2] pumasi.config.yaml 작성 (시그니처 + 요구사항만!)
[Phase 3] pumasi.sh start
[Phase 4] pumasi.sh wait
[Phase 5] 게이트 검증 (tsc → build → test)
[Phase 6] 통합 + 완성
```

---

## 모던 기술스택 기본 원칙

Claude가 instruction을 작성할 때, 항상 최신 안정 버전 기준으로 기술을 선택한다.

**2025-2026 기준 모던 스택:**

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
~/.claude/skills/pumasi/
├── SKILL.md                    # 이 문서
├── pumasi.config.yaml          # 작업 목록 (매 실행 전 수정)
└── scripts/
    ├── pumasi.sh               # 진입점
    ├── pumasi-job.sh           # Node.js 래퍼
    ├── pumasi-job.js           # 오케스트레이터
    └── pumasi-job-worker.js    # Codex 워커 (detached)
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
which codex  # 설치 확인
# 없으면: npm install -g @openai/codex
```

**instruction 자기 점검 (Phase 2 작성 후):**
```
□ instruction에 10줄 이상의 코드 블록이 있는가? → 있으면 삭제
□ "그대로 작성하세요"가 있는가? → 있으면 요구사항으로 변환
□ 함수 본문(body)을 작성했는가? → 시그니처만 남기기
□ tsc/build 게이트가 있는가? → 없으면 추가
□ 제약사항에 라이브러리 강제가 있는가? → 없으면 추가
```
