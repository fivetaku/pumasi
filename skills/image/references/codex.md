# Codex에서 실행할 때 (pumasi:image)

SKILL.md 절차는 그대로 따르고, 아래 차이만 적용한다.

## Step 3 질문 = 질문 도구 (이번 세션 도구 목록으로 판단)

1. `request_user_input_async`가 있으면 이 도구 1콜(문항 4개 이하)로 묻는다.
   - 형식: `{"questions":[{"title":"헤더 — 질문","options":["추천안 (추천) — 설명","대안 — 설명"]}]}`
   - 문항에는 `title`·`options`만. `question`·`header`·`id`는 넣지 않는다. 추천안 맨 앞, "자동 판단"은 선택지로 두되 "기타"는 넣지 않는다.
   - 부른 뒤 "위 질문에 답해 주시면 이어서 진행합니다" 한 줄만 쓰고 턴을 끝낸다.
2. Plan 모드라 `request_user_input`만 있으면: 1콜 3문항까지, 선택지 2~3개(`header` 12자 이내, `id` snake_case, 추천 라벨 끝 `(Recommended)`). 4문항이면 두 번에 나눈다.
3. 둘 다 없으면 채팅에 번호 블록으로 묻는다(`Q1.` / `1. 추천안 — 설명` / ... / "모르면 전부 1번으로 진행").
4. `codex exec` 등 사람이 답할 수 없는 실행이면 묻지 않고 기본값으로 진행한다.

## Codex 백엔드 = 네이티브 이미지 도구 직접 호출

- Codex 안에서 Codex 백엔드를 고르면 `imagen.sh`(내부에서 `codex exec`를 자식으로 띄움)를 거치지 말고 Codex의 네이티브 이미지 도구(`image_gen`)를 직접 호출한다. 후처리 금지·저장 경로 규칙은 SKILL.md와 같다.
- Grok·ChatGPT 웹(GIF) 백엔드는 Codex에서도 `imagen.sh --backend grok|web`을 쓴다.
- `Skill`·`Task`에 기대는 단계는 없다.
- 첫 실행 설정(`setup/setup.sh`)은 Claude Code 전용이다. Codex에서는 실행하지 않는다.
