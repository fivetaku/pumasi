---
name: pumasi
description: Claude가 큰 그림을 설계하고 Codex를 병렬 외주 개발자로 활용하는 스킬. 독립적인 서브태스크를 Codex에 분배하여 동시 구현 후 Claude가 검토·통합한다. "/pumasi", "품앗이로 만들어줘", "품앗이 켜줘", "codex 외주로", "codex한테 시켜" 같은 요청에 사용됩니다. 3개 이상의 독립 모듈을 동시에 만들어야 할 때 자동 감지됩니다.
---

# 품앗이 (Pumasi) — Codex 병렬 외주 개발

> 품앗이: 서로 협력하며 일을 나눠 하는 한국 전통 방식
> Claude = 설계/감독 | Codex x N = 병렬 구현자

## 핵심 가치

**품앗이의 존재 이유는 "Claude가 코드를 짜지 않는 것"이다.**

| 가치 | 설명 |
|------|------|
| Claude 토큰 절약 | Claude는 설계만, 구현은 Codex가 담당 |
| 속도 향상 | N개 모듈을 Codex가 병렬로 동시 구현 |
| 검증 최적화 | 동적 게이트(bash, 토큰 0)로 자동 검증 |

**전제 조건**: Codex가 **실제 구현**을 해야 한다. Claude가 코드를 다 짜고 Codex에게 복사만 시키면 토큰 절약 효과 = 0.

---

## CRITICAL: 안티패턴 — 복붙형 instruction (절대 금지)

> **이 섹션은 품앗이의 가장 중요한 규칙이다. 반드시 숙지하라.**

다음 패턴이 발견되면 품앗이의 가치가 완전히 사라진다:

```
NEVER DO:
- instruction에 완성된 함수/컴포넌트 코드 블록 포함
- "위 코드를 그대로 작성하세요" 패턴
- Claude가 구현을 다 한 후 Codex에게 파일 저장만 시키는 것
- JSX/HTML 마크업을 instruction에 직접 작성
- 비즈니스 로직을 코드로 제공
```

**왜 이런 실수가 발생하는가?**
1. Claude(LLM)는 "과잉 친절" 성향이 있어 코드를 끝까지 완성하려 함
2. "모든 것을 명시하라"를 "구현까지 다 써라"로 오해
3. 게이트가 약하면(ls/grep만) Claude가 불안해서 코드를 다 써버림
4. **해결: 시그니처+요구사항만 작성하고, 강한 게이트(tsc/build/test)로 검증**

---

## Claude vs Codex 역할 분리 (핵심 경계)

### Claude가 제공하는 것 (instruction에 포함)

```
OK: 타입/인터페이스 정의 (body 없이)
OK: 함수/클래스 시그니처 (body 없이)
OK: 요구사항 (자연어, 구체적)
OK: 제약사항 (라이브러리명, 스타일 규칙, 금지사항)
OK: 필수 import 라인 (1~2줄)
OK: 데이터 모델/스키마 정의
OK: 기존 코드 참조 경로 (reference_files)
OK: 프로젝트 컨텍스트
```

### Codex가 구현하는 것 (Claude가 작성 금지)

```
NEVER: 함수/메서드 본문 (body)
NEVER: 컴포넌트 렌더링 로직 (JSX/HTML)
NEVER: 비즈니스 로직 구현
NEVER: CSS/스타일 코드
NEVER: 이벤트 핸들러 구현
NEVER: API 호출 로직
NEVER: 데이터 변환/처리 로직
```

### 경계선 예시

```
Claude가 주는 것:
  export function generateToken(userId: string, role: string): string
  - jsonwebtoken 사용 (필수 import: import jwt from 'jsonwebtoken')
  - 만료: 7일, secret: process.env.JWT_SECRET

Codex가 구현하는 것:
  export function generateToken(userId: string, role: string): string {
    return jwt.sign({ userId, role }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  }
```

Claude는 **위쪽만** 작성한다. 아래쪽은 Codex가 채운다.

---

## 트리거 조건

```
명시적: "/pumasi", "품앗이로", "품앗이 켜줘", "codex 외주로", "codex한테 시켜"
자동 감지: 4개+ 독립 파일/모듈 동시 작성 요청
```

### 작업 규모별 분기

| 규모 | 권장 방식 | 이유 |
|------|----------|------|
| 1~2개 | **Claude 직접 코딩** | 품앗이 오버헤드가 더 큼 |
| 3~4개 | **품앗이 사용 가능** | 병렬 이득 = 오버헤드 |
| 5개+ | **품앗이 강력 권장** | 병렬 이득이 확실히 큼 |

**품앗이를 사용하지 않는 경우:**
- 기존 코드 수정/버그 수정 (컨텍스트 주입 과도)
- 단일 파일 작업 (병렬 이점 없음)
- 게이트를 만들 수 없는 작업 (UI 미세 조정 등)

### /batch와의 관계

| | 품앗이 (Pumasi) | /batch |
|--|----------------|--------|
| **목적** | 독립 모듈 N개 동시 구현 (Greenfield) | 동일 패턴을 N개 파일에 반복 적용 (Brownfield) |
| **워커** | Codex CLI (Codex 토큰) | Claude 에이전트 (Claude 토큰) |

- "3개 독립 모듈" → **품앗이**
- "프로젝트 전체 A→B 변환" → **/batch**
- 조합: **품앗이 + /simplify + /batch**

---

## 7단계 워크플로우

### Phase 0: 기획 (Claude as PM)
사용자 요청을 분석하여 완성도 있는 기획안 작성. 사용자 승인 후 진행.
> 상세: `Read references/pm-workflow.md`

### Phase 1: 분석 (Claude)
독립적으로 병렬 실행 가능한 서브태스크로 분해.
> 상세: `Read references/task-patterns.md`

### Phase 2: 설정 (Claude)
`pumasi.config.yaml`의 `tasks:` 섹션 수정. 시그니처+요구사항만 작성.
> 상세: `Read references/codex-templates.md`

### Phase 3: 실행 (Claude -> Bash)
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/pumasi.sh start "프로젝트 개요: [간단한 설명]"
```

### Phase 4: 모니터링 (Claude)
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/pumasi.sh wait [JOB_DIR]
```

### Phase 5: 게이트 검증 (Claude)
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/pumasi.sh results [JOB_DIR]
```
> 게이트 설계 상세: `Read references/gate-examples.md`

### Phase 5.5: 코드 정리 (선택적)
게이트 전부 PASS + 태스크 3개 이상일 때 `/simplify` 실행 권장.
- `/simplify` 후 게이트를 한 번 더 실행하여 기능 보존 확인
- 2개 이하 소규모 태스크에서는 스킵

### Phase 6: 통합 및 수정
- 수정 필요 시: Claude가 **직접 고치지 않고** Codex에 재위임
- 수정 불필요 시: 서브태스크 간 연결 확인 후 정리

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/pumasi.sh clean [JOB_DIR]
```

> 스크립트 커맨드 전체: `Read references/script-guide.md`

---

## 품앗이 모드 진입 시 Claude의 행동 변화

```
일반 모드:          품앗이 모드:
Claude가 직접 코딩  Claude가 시그니처+요구사항 작성
                   → pumasi.sh 실행 → Codex가 구현
                   → 게이트 자동 검증 → 통합
```
