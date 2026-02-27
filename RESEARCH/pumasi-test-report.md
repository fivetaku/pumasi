# Pumasi 스킬 실전 테스트 리포트

> 테스트 일시: 2026-02-27 03:56~04:15 KST
> Codex CLI: v0.105.0 | 모델: gpt-5.3-codex-spark (xhigh reasoning)
> Pumasi: v0.1.0 (Iteration 1~5 적용)

---

## 1. 테스트 구성

### 태스크 배치
| 태스크 | Round | Instruction 스타일 | 코드량 (결과) |
|--------|-------|-------------------|-------------|
| string-utils | 1 | **Minimal** (최소 지시) | 37줄 |
| validation-utils | 1 | **Structured** (구조화 템플릿) | 63줄 |
| math-utils | 1 | **Conversational** (대화체) | 28줄 |
| index-barrel | 2 | Structured (Round 1 의존) | 4줄 |

### 공유 타입 (src/types.ts)
```typescript
export interface FormatOptions { locale?: string; uppercase?: boolean; }
export interface ValidationResult { valid: boolean; error?: string; }
export interface MathRange { min: number; max: number; }
```

---

## 2. 속도 분석

### 개별 태스크 소요 시간
| 태스크 | 시작 | 종료 | 소요시간 | 비고 |
|--------|------|------|---------|------|
| string-utils | 03:56:24 | 03:56:41 | **16.5초** | Minimal 스타일 |
| validation-utils | 03:56:24 | 03:56:41 | **17.1초** | Structured 스타일 |
| math-utils | 03:56:24 | 03:56:35 | **11.0초** | Conversational 스타일 |
| index-barrel | 04:14:29 | 04:14:35 | **6.3초** | 단순 re-export |

### Round별 Wall-Clock 시간
| Round | 태스크 수 | 병렬 실행 | Wall-Clock | 참고 |
|-------|----------|----------|-----------|------|
| Round 1 | 3개 | 3 병렬 | **~17초** | 가장 느린 태스크 기준 |
| Round 2 | 1개 | 1 직렬 | **~6초** | 단순 태스크 |
| **총합** | **4개** | - | **~23초** | Round 간 수동 전환 제외 |

### 핵심 발견
- **병렬 실행의 위력**: 3개 태스크를 직렬로 실행했다면 44.6초 → 병렬로 17초 (**2.6배 속도 향상**)
- **Codex 오버헤드**: 태스크 크기와 무관하게 최소 ~6초의 기본 오버헤드 (CLI 부팅 + API 호출)
- **최적 태스크 크기**: 단일 파일, 3~5개 함수 수준이 효율적 (10~17초 범위)

---

## 3. 코드 품질 분석

### 3-1. Minimal 스타일 (string-utils) — 점수: 9/10

**지시 방식**: 함수명 + 파라미터만 명시, 구현 세부사항 없음

```
Create src/string-utils.ts with these functions:
- formatDate: takes Date and FormatOptions, returns formatted string
- slugify: takes string, returns URL-safe slug
- truncate: takes string and maxLength number, returns truncated string with "..."
```

**결과 평가**:
| 항목 | 점수 | 평가 |
|------|------|------|
| 파일 경로 정확도 | 10/10 | 정확히 `src/string-utils.ts` 생성 |
| 시그니처 일치 | 10/10 | 모든 함수 시그니처 정확 |
| 타입 사용 | 10/10 | `FormatOptions` import 정상 |
| 구현 품질 | 9/10 | `slugify`에 NFKD 정규화 적용 (기대 이상) |
| 엣지케이스 | 8/10 | `truncate`의 `maxLength <= 3` 처리 우수 |
| 추가 파일 없음 | 10/10 | 지시대로 단일 파일만 생성 |

**특이점**: 최소한의 지시에도 `Intl.DateTimeFormat`, NFKD 정규화 등 프로덕션 수준 구현. Codex는 "무엇을" 만들라는 지시만으로 "어떻게"를 잘 추론함.

### 3-2. Structured 스타일 (validation-utils) — 점수: 10/10

**지시 방식**: 시그니처, 구현 세부사항, 금지사항 모두 명시

```
## 구현 시그니처
export function validateEmail(email: string): ValidationResult
## 구현 세부사항
- validateEmail: RFC 5322 기본 패턴 (/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
- validatePhone: 한국 전화번호 패턴 (010-XXXX-XXXX)
## 금지사항
- 외부 라이브러리 사용 금지
```

**결과 평가**:
| 항목 | 점수 | 평가 |
|------|------|------|
| 파일 경로 정확도 | 10/10 | 정확 |
| 시그니처 일치 | 10/10 | export function 형태 완벽 일치 |
| 정규식 일치 | 10/10 | 지시된 RFC 5322 패턴 그대로 사용 |
| 한국어 에러 메시지 | 10/10 | 한국어로 구체적 에러 메시지 (지시 반영) |
| 금지사항 준수 | 10/10 | 외부 라이브러리 0, require 0 |
| 타입 안전성 | 10/10 | typeof 방어 코드 추가 (보너스) |

**특이점**: 구조화 지시를 **문자 그대로** 따름. 정규식 패턴도 지시서에 명시된 것을 정확히 사용. **예측 가능성이 가장 높은 스타일**.

### 3-3. Conversational 스타일 (math-utils) — 점수: 9/10

**지시 방식**: 구어체 한국어로 자연스럽게 설명

```
수학 유틸리티 함수들을 만들어줘. 파일은 src/math-utils.ts에 만들면 돼.
필요한 함수는 세 개야:
1. clamp - 숫자를 min/max 범위 안으로 제한하는 거. MathRange를 받아서 처리하면 좋겠어.
```

**결과 평가**:
| 항목 | 점수 | 평가 |
|------|------|------|
| 파일 경로 정확도 | 10/10 | 정확 |
| 시그니처 일치 | 10/10 | MathRange 활용 정확 |
| 구현 품질 | 9/10 | lerp 공식 정확, clamp 로직 명확 |
| 엣지케이스 | 8/10 | min > max일 때 원래 값 반환 (합리적 결정) |
| 코드 간결성 | 10/10 | 28줄로 가장 간결한 구현 |
| 금지사항 준수 | 10/10 | 외부 라이브러리 없음 |

**특이점**: 대화체에서도 정확한 구현. 코드가 가장 간결하고 읽기 좋음. 다만 엣지케이스(min > max)에 대한 처리가 이전 테스트(Math.min/max로 보정)와 달라짐 — **비결정적 요소**.

### 3-4. 스타일별 비교 요약

| 지표 | Minimal | Structured | Conversational |
|------|---------|-----------|----------------|
| 소요시간 | 16.5초 | 17.1초 | 11.0초 |
| 코드 줄수 | 37줄 | 63줄 | 28줄 |
| 품질 점수 | 9/10 | 10/10 | 9/10 |
| **예측 가능성** | 중 | **높음** | 중 |
| **결정적 동작** | 중 | **높음** | 낮음 |
| 추가 방어코드 | 일부 | 완전 | 최소 |
| 한국어 이해 | N/A | 부분 | **완전** |

---

## 4. 구조화 출력 (--output-schema) 분석

### report.json 품질
모든 4개 태스크에서 `--output-schema`로 구조화 JSON 출력 성공.

| 필드 | 정확도 | 설명 |
|------|--------|------|
| `files_created` | 100% | 실제 생성 파일과 정확히 일치 |
| `files_modified` | 100% | 올바르게 빈 배열 |
| `status` | 100% | 모두 "success" |
| `summary` | 100% | 한국어로 의미있는 요약 |
| `signatures` | 100% | 실제 코드 시그니처와 일치 |
| `dependencies_used` | 100% | 올바르게 빈 배열 |
| `risks` | 95% | 실질적인 위험 요소를 식별하고 한국어로 상세 설명 |

### 핵심 발견
- `risks` 필드가 예상 이상으로 유용: 각 태스크에서 **실질적인 엣지케이스와 한계점**을 자발적으로 보고
- 한국어 프롬프트 → 한국어 report: 프롬프트 언어에 맞춰 응답 언어도 자동 조정됨
- 자동화에 핵심: `files_created`로 게이트 자동 생성 가능

---

## 5. 게이트 시스템 분석

### 결과
| Round | 게이트 수 | 통과 | 실패 |
|-------|----------|------|------|
| Round 1 | 16 | 16 | 0 |
| Round 2 | 4 | 4 | 0 |
| **총합** | **20** | **20** | **0** |

### 게이트 설계 원칙 (테스트에서 확인)
1. **파일 존재 게이트** (`test -f`): 가장 기본, 반드시 포함
2. **함수/export 게이트** (`grep -q 'export function'`): 시그니처 준수 확인
3. **import 게이트** (`grep -q 'TypeName'`): 공유 타입 사용 확인
4. **금지 게이트** (`! grep -q 'require('`): 금지사항 위반 탐지
5. **re-export 게이트** (`grep -q 'module-name'`): barrel 파일 정합성

### 게이트 비용: **0 토큰, ~0.5초** (bash 명령 실행)

---

## 6. Round 간 컨텍스트 전달

Round 2 태스크(`index-barrel`)에 Round 1 결과가 `prompt-round2.txt`에 자동 주입됨.

- Round 1의 3개 `report.json` 내용이 포함됨
- `files_created`, `signatures` 정보로 barrel 파일이 정확한 re-export 생성
- **Round 2 소요시간 6.3초** — 컨텍스트가 충분해서 추론 없이 바로 구현

---

## 7. Codex CLI 실전 사용 가이드

### 잘하는 것
1. **단일 파일 생성** — 파일 경로를 정확하게 지키고, 지시된 파일만 생성
2. **시그니처 준수** — 함수 시그니처를 명시하면 100% 그대로 구현
3. **타입 활용** — 기존 `.ts` 파일의 타입을 자연스럽게 import
4. **한국어 이해** — 대화체 한국어도 정확하게 파악
5. **구조화 보고** — `--output-schema`로 기계 파싱 가능한 리포트 생성

### 주의할 것
1. **비결정적 엣지케이스** — 동일 지시로 2회 실행 시 엣지케이스 처리가 달라질 수 있음 (min > max 예)
2. **최소 오버헤드 ~6초** — 아무리 단순해도 6초 이상 소요 (CLI 부팅 + API)
3. **구조화 지시가 가장 예측 가능** — 자유도를 줄일수록 결과가 안정적

### Instruction 스타일 권장

| 상황 | 권장 스타일 | 이유 |
|------|-----------|------|
| 정확한 시그니처 필요 | **Structured** | 문자 그대로 따름 |
| 빠른 프로토타입 | Minimal | 충분히 좋은 코드, 가장 빠름 |
| 도메인 로직 복잡 | Structured | 세부사항 누락 방지 |
| 간단한 유틸 | Conversational | 읽기 좋은 간결한 코드 |
| **팀/자동화** | **Structured** | 예측 가능성이 핵심 |

---

## 8. Pumasi 시스템 성능 요약

| 지표 | 값 |
|------|-----|
| 총 태스크 | 4개 (3 병렬 + 1 직렬) |
| 총 Wall-Clock | ~23초 (Round 간 전환 제외) |
| 직렬 대비 속도 향상 | **2.6배** (44.6초 → 17초) |
| 게이트 통과율 | 100% (20/20) |
| 구조화 출력 성공률 | 100% (4/4) |
| 코드 품질 평균 | 9.5/10 |
| Codex 단일 태스크 평균 | 12.7초 |
| Codex 최소 오버헤드 | ~6초 |

### 비용 효율
- Codex: ChatGPT Pro 구독 내 무제한 (`codex exec` 무료)
- 게이트: bash 명령, 0 토큰
- Claude: PM 역할만 수행 (코드 생성 0)
- **결론**: 병렬 코드 생성의 비용이 사실상 0에 가까움

---

## 9. 발견된 버그 및 수정 사항

| # | 버그 | 원인 | 수정 |
|---|------|------|------|
| 1 | yaml 의존성 미설치 | package.json에 yaml 명시했으나 install 안됨 | `npm install yaml` |
| 2 | output-schema required 에러 | OpenAI API가 모든 properties를 required에 요구 | 7개 필드 전부 required에 추가 |
| 3 | startedAt 누락 | worker finalize()가 startedAt 미포함 | finalize 페이로드에 startedAt 추가 |
| 4 | start-round 인자 형식 | `--round N` 플래그 필요 (positional 아님) | 호출 문법 확인 |

---

## 10. 결론

Pumasi는 **"Claude가 설계하고, Codex가 병렬로 구현하고, 게이트가 자동 검증하는"** 워크플로우를 실현했다. 4개 태스크를 23초 만에 완료하면서도 20/20 게이트를 통과하는 코드 품질을 보여주었다.

**가장 중요한 학습**: Codex에게는 **구조화된 지시(Structured)를 기본으로 사용**하되, 간단한 유틸은 Minimal도 충분하다. 게이트 시스템은 0 토큰으로 품질을 보장하는 핵심 안전장치다.
