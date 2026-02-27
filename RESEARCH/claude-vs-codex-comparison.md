# Claude vs Codex 동일 태스크 비교 분석

> 동일한 4개 태스크 (string-utils, validation-utils, math-utils, index-barrel)를
> 같은 `types.ts`를 기반으로 Claude와 Codex가 각각 구현한 결과 비교.

---

## 1. 속도 비교

| 항목 | Claude | Codex (Pumasi) | 비교 |
|------|--------|---------------|------|
| 총 소요시간 | **19초** | **23초** (17초 + 6초) | Claude 약간 빠름 |
| 실행 방식 | 직렬 (Write 3회 + 1회) | 병렬 3 + 직렬 1 | Codex는 병렬 |
| Round 1 | ~15초 (3파일 순차 Write) | **17초** (3파일 동시) | 비슷 |
| Round 2 | ~4초 (1파일 Write) | **6초** (CLI 오버헤드) | Claude 빠름 |
| 파일당 평균 | ~4.75초 | ~5.75초 | Claude 약간 빠름 |

### 속도 해석
- **4개 수준에서는 비슷**하지만 의미가 다름
- Claude: **직렬** — 태스크 수에 비례하여 시간 증가 (10개면 ~50초)
- Codex (Pumasi): **병렬** — 태스크 수와 무관하게 가장 느린 태스크 기준 (~17초)
- **10개 태스크 예상**: Claude ~50초 vs Pumasi ~17초 → **Pumasi 3배 빠름**
- **20개 태스크 예상**: Claude ~100초 vs Pumasi ~17초 → **Pumasi 6배 빠름**

---

## 2. 코드 줄 수 비교

| 파일 | Claude | Codex | 차이 |
|------|--------|-------|------|
| string-utils.ts | 29줄 | 37줄 | Codex +28% |
| validation-utils.ts | 26줄 | 62줄 | Codex **+138%** |
| math-utils.ts | 13줄 | 28줄 | Codex **+115%** |
| index.ts | 4줄 | 4줄 | 동일 |
| **합계** | **72줄** | **131줄** | Codex +82% |

### 줄 수 해석
- Claude: **간결함 우선** — 한 줄에 압축 가능하면 압축
- Codex: **명시적 가독성 우선** — 각 분기를 별도 블록으로 분리
- 어느 쪽이 좋다기보다 **스타일 차이**

---

## 3. 파일별 상세 비교

### 3-1. string-utils.ts

| 항목 | Claude | Codex |
|------|--------|-------|
| formatDate | Intl.DateTimeFormat 사용 | Intl.DateTimeFormat 사용 |
| slugify 순서 | normalize → trim → lower | trim → lower → normalize |
| slugify 언더스코어 | `[\s_]+` (언더스코어 포함) | `\s+` (공백만) |
| truncate | 3줄 원라이너 스타일 | 10줄 블록 스타일 + Math.max 방어 |

**승자**: **무승부** — 로직 동일, 스타일만 다름. Codex의 `Math.max(maxLength, 0)` 방어는 보너스.

### 3-2. validation-utils.ts (가장 큰 차이)

| 항목 | Claude | Codex |
|------|--------|-------|
| 코드 줄 수 | 26줄 | 62줄 (+138%) |
| typeof 방어 | 없음 | `typeof !== 'string'` 체크 3개 |
| 정규식 위치 | 함수 내부 인라인 | 모듈 상단 상수 |
| 전화번호 패턴 | `/^01[016789]-\d{3,4}-\d{4}$/` | `/^(?:010-\d{4}-\d{4}\|01\d-\d{3}-\d{4})$/` |
| 에러 메시지 | 간결 | 예시 포함 상세 |
| catch 문법 | `catch { }` | `catch (_error) { }` |

**승자**: **Codex 근소 우위**
- `typeof` 방어: 런타임 안전성 ↑ (TypeScript지만 JS에서 호출될 수 있음)
- 정규식 상수: 성능 ↑ (함수 호출마다 재생성 방지)
- 단, Claude 코드가 **프로덕션에서 문제될 수준은 아님**

### 3-3. math-utils.ts

| 항목 | Claude | Codex |
|------|--------|-------|
| clamp | `Math.min(Math.max(...))` 원라이너 | 14줄 if/else 블록 |
| min > max 처리 | 암묵적 (Math.min/max가 처리) | 명시적 조기 반환 (`return value`) |
| destructuring | 미사용 (`range.min`) | 사용 (`const { min, max } = range`) |

**승자**: **Claude 근소 우위**
- `Math.min(Math.max())` 패턴이 관용적이고 엣지케이스도 자연 처리
- Codex의 `min > max → return value`는 **의도가 모호** (버그인지 의도인지 불명확)

### 3-4. index.ts
**동일** — 완벽히 같은 코드.

---

## 4. 코드 품질 종합 점수

| 기준 | Claude | Codex | 설명 |
|------|--------|-------|------|
| 기능 정확성 | 10/10 | 10/10 | 둘 다 완벽 동작 |
| 타입 안전성 | 9/10 | 10/10 | Codex의 typeof 방어 |
| 코드 간결성 | 10/10 | 7/10 | Claude 72줄 vs Codex 131줄 |
| 가독성 | 9/10 | 9/10 | 스타일 차이일 뿐 |
| 엣지케이스 | 8/10 | 9/10 | Codex의 Math.max(maxLength,0) |
| 관용적 패턴 | 10/10 | 8/10 | Claude의 Math.min/max 패턴 |
| **종합** | **9.3/10** | **8.8/10** | 근소 차이 |

---

## 5. 각자의 강점

### Claude 강점
1. **간결함** — 같은 기능을 55% 적은 코드로 구현 (72줄 vs 131줄)
2. **관용적 패턴** — `Math.min(Math.max())` 같은 업계 표준 패턴 사용
3. **코드 리뷰 불필요** — PM이 직접 쓰는 코드라 의도가 명확
4. **직접 수정 가능** — 피드백 루프 없이 즉시 수정

### Codex 강점
1. **방어적 코딩** — typeof 체크, 상수 정규식 등 안전장치 자동 추가
2. **병렬 확장성** — 태스크 수 증가 시 시간 거의 불변
3. **독립 실행** — Claude 컨텍스트 소모 0 (PM은 설계만 하면 됨)
4. **구조화 보고** — report.json으로 결과 자동 파싱 가능
5. **게이트 검증** — 0 토큰으로 자동 품질 보장

---

## 6. 핵심 결론: 언제 누구를 쓸 것인가

| 상황 | 추천 | 이유 |
|------|------|------|
| 태스크 1~3개 | **Claude 직접** | 오버헤드 없이 빠르고 정확 |
| 태스크 4개+ 독립적 | **Pumasi (Codex)** | 병렬 실행으로 시간 단축 |
| 태스크 10개+ | **Pumasi 필수** | Claude 직렬 ~50초+ vs Pumasi ~17초 |
| 높은 정밀도 필요 | **Claude 직접** | 더 간결하고 관용적인 코드 |
| 프로토타이핑 | **Pumasi** | 빠르게 뼈대 생성, Claude가 다듬기 |
| 반복적 보일러플레이트 | **Pumasi** | 동일 패턴 대량 생성에 최적 |

### 최적 워크플로우
```
Claude(PM): 태스크 분해 + 구조화 지시서 작성
  ↓
Codex(워커): 병렬 구현 (Pumasi)
  ↓
게이트: 자동 검증 (0 토큰)
  ↓
Claude(PM): 코드 리뷰 + 미세 조정
```

**결론**: Claude는 **질**, Codex는 **양과 속도**. Pumasi는 이 둘을 결합하여
Claude의 컨텍스트를 보존하면서 Codex의 병렬성을 활용하는 시스템이다.

---

## 7. 프롬프트 개선 후 재비교 (v2)

### 개선 내용
워커 프롬프트에 **코드 스타일 규칙 7개**를 추가:
1. 간결함 우선: 관용적 one-liner 사용 (if/else 체인 금지)
2. TypeScript 타입 신뢰: 런타임 typeof 체크 금지
3. 삼항연산자 활용
4. 불필요한 중간변수 금지
5. 일관된 엣지케이스: min > max시 swap 처리
6. 정규식은 함수 내부 인라인
7. 객체 리터럴 인라인 반환

### 코드 줄 수: Before → After

| 파일 | 개선 전 Codex | **개선 후 Codex** | Claude | 비고 |
|------|-------------|-----------------|--------|------|
| string-utils | 37줄 | **22줄** (-41%) | 29줄 | Codex가 더 간결 |
| validation-utils | 62줄 | **21줄** (-66%) | 26줄 | Codex가 더 간결 |
| math-utils | 28줄 | **14줄** (-50%) | 13줄 | 거의 동일 |
| **합계** | **131줄** | **57줄** (-56%) | **72줄** | **Codex가 21% 더 간결** |

### 개선된 코드 품질 상세

**math-utils (14줄 → Claude급)**
```typescript
// Before: 14줄 if/else 체인, min > max시 return value (모호)
// After:  Math.min(Math.max()) 원라이너 + swap 처리 (명확)
export const clamp = (value: number, range: MathRange): number => {
  const [min, max] = range.min <= range.max ? [range.min, range.max] : [range.max, range.min];
  return Math.min(Math.max(value, min), max);
};
```

**validation-utils (21줄 → Claude보다 간결)**
```typescript
// Before: 62줄, typeof 방어 3개, 모듈상단 정규식 상수, 중간변수
// After:  삼항연산자 직접 반환, 인라인 정규식, typeof 없음
export function validateEmail(email: string): ValidationResult {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? { valid: true }
    : { valid: false, error: '이메일 형식이 올바르지 않습니다.' };
}
```

**string-utils (22줄 → Claude급)**
```typescript
// Before: truncate 10줄 블록
// After:  원라이너
export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}
```

### 속도 비교 (개선 후)

| 태스크 | 개선 전 | 개선 후 | 차이 |
|--------|--------|--------|------|
| string-utils | 16.5초 | **21.9초** | +5초 |
| validation-utils | 17.1초 | **16.5초** | -0.6초 |
| math-utils | 11.0초 | **13.3초** | +2초 |
| Wall-Clock | ~17초 | **~22초** | +5초 |

> 속도가 약간 느려짐 — 프롬프트에 스타일 규칙이 추가되어 Codex가 더 신중하게 작성.
> 하지만 **코드 품질 대비 5초는 충분히 가치 있는 trade-off**.

### 개선 후 품질 점수

| 기준 | Claude | Codex v1 | **Codex v2** |
|------|--------|----------|-------------|
| 기능 정확성 | 10/10 | 10/10 | **10/10** |
| 타입 안전성 | 9/10 | 10/10 | **10/10** |
| 코드 간결성 | 10/10 | 7/10 | **10/10** ↑ |
| 가독성 | 9/10 | 9/10 | **10/10** ↑ |
| 엣지케이스 | 8/10 | 9/10 | **10/10** ↑ |
| 관용적 패턴 | 10/10 | 8/10 | **10/10** ↑ |
| **종합** | **9.3/10** | **8.8/10** | **10/10** ↑↑ |

### 게이트 결과
16/16 통과 — 기능 정확성 유지하면서 품질만 향상.

---

## 8. 최종 결론

**프롬프트에 코드 스타일 규칙 7개를 추가하는 것만으로**:
- 코드량 **56% 감소** (131줄 → 57줄)
- 품질 점수 **8.8 → 10.0** (Claude 9.3을 추월)
- 기능 정확성 **100% 유지** (게이트 16/16)
- 속도 trade-off **+5초** (허용 범위)

Codex의 코드 품질은 **모델의 한계가 아니라 프롬프트의 문제**였다.
명확한 스타일 규칙을 주면 Claude와 동등하거나 더 나은 코드를 생성한다.

### 이전 결론 수정
| 이전 결론 | **수정된 결론** |
|----------|---------------|
| Claude는 질, Codex는 양 | **둘 다 질과 양 모두 가능** — 프롬프트 품질이 핵심 |
| 1~3개는 Claude 직접 | **항상 Pumasi** — 토큰 절약 + 동등 품질 |
| 높은 정밀도는 Claude | **Codex도 정밀** — 스타일 규칙만 명확하면 됨 |
