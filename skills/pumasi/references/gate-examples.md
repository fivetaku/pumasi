# 게이트(Gate) 설계 가이드

## 게이트 설계 원칙

> **게이트가 강하면 Claude가 코드를 쓸 필요가 없다.**
> tsc/build/test가 통과했다면 구현이 올바른 것이다.

## 4단계 검증 프로세스

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

## 게이트 우선순위 (필수 → 권장)

| 우선순위 | 게이트 | 검증 대상 |
|---------|--------|----------|
| **필수** | `npx tsc --noEmit` | 타입 안전성 |
| **필수** | `npm run build` (있으면) | 빌드 성공 |
| 권장 | `npm test -- --run` (있으면) | 기능 동작 |
| 권장 | `grep -q '라이브러리명'` | 지정 라이브러리 사용 |
| 선택 | `[ -f [파일경로] ]` | 파일 존재 |

## 태스크 유형별 권장 게이트

| 태스크 유형 | 권장 게이트 |
|------------|-----------|
| 백엔드 API | tsc --noEmit, 라이브러리 grep, 시그니처 grep |
| 프론트엔드 UI | npm run build, 컴포넌트명 grep |
| 유틸리티 | tsc --noEmit, export 함수 grep |
| DB/스키마 | tsc --noEmit, 테이블/컬럼 grep |
| 풀스택 | npm run build, npm test |

## 셸 호환성 주의

```
❌ test -f file.ts       # 일부 셸에서 alias/function에 의해 간섭될 수 있음
✅ [ -f file.ts ]        # POSIX 브래킷 문법, alias 간섭 없음

❌ ls file.ts             # 출력이 장황함
✅ [ -f file.ts ]        # 깔끔한 exit code만 반환
```

## 라이브러리 대체 방지 게이트 예시

Codex가 라이브러리를 대체하는 문제를 게이트로 해결:

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
