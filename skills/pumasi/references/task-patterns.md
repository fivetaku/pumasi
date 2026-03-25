# 태스크 분해 패턴

## 좋은 서브태스크 조건

- 다른 서브태스크 완료를 기다리지 않아도 됨
- 명확한 입출력(시그니처) 정의 가능
- Codex 혼자 구현 가능한 범위
- 파일/기능 경계가 명확함

## 적정 분해 예시 (인증 시스템)

```
Round 1 (병렬):
  task1: JWT 토큰 유틸리티 (auth/token.ts)
  task2: 비밀번호 해싱 유틸리티 (auth/password.ts)
  task3: 사용자 모델 + DB 스키마 (models/user.ts)
Round 2 (후속):
  task4: 인증 API 엔드포인트 (routes/auth.ts) ← task1,2,3 완료 후
```

## 순서 의존성 처리 (라운드 분리)

태스크 간 의존성이 있으면 **라운드**로 분리:
```
Round 1: 공유 타입/유틸리티 (3개 병렬)
Round 2: Round 1 결과 사용하는 태스크 (2개 병렬)
Round 3: 최종 통합 (Claude 직접)
```

## 실행 예시: Todo 앱 (PM 기획 포함)

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

## 데이터 모델 설계 원칙

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
