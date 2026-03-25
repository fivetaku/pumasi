# Codex Instruction 템플릿 & 작성 가이드

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

## 좋은 instruction vs 나쁜 instruction

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

## Codex에게 효과적인 instruction 규칙

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

## instruction YAML 예시

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

## instruction 자기 점검 (Phase 2 작성 후)

```
□ instruction에 10줄 이상의 코드 블록이 있는가? → 있으면 삭제
□ "그대로 작성하세요"가 있는가? → 있으면 요구사항으로 변환
□ 함수 본문(body)을 작성했는가? → 시그니처만 남기기
□ tsc/build 게이트가 있는가? → 없으면 추가
□ 제약사항에 라이브러리 강제가 있는가? → 없으면 추가
```
