# Codex에서 실행할 때 (pumasi)

SKILL.md 절차는 그대로 따르고, 아래 차이만 적용한다.

## 질문 = 질문 도구 (이번 세션 도구 목록으로 판단)

1. `request_user_input_async`가 있으면 이 도구 1콜로 묻는다(문항 4개 이하를 한 번에: 기획 승인 + 워커 선택).
   - 형식: `{"questions":[{"title":"헤더 — 질문","options":["추천안 (추천) — 설명","대안 — 설명"]}]}`
   - 문항에는 `title`·`options`만. `question`·`header`·`id`를 넣으면 파싱 오류가 난다. 추천안을 맨 앞에, "기타" 옵션은 넣지 않는다.
   - 부른 뒤 "위 질문에 답해 주시면 이어서 진행합니다" 한 줄만 쓰고 턴을 끝낸다. 답은 다음 메시지로 온다.
2. Plan 모드라 `request_user_input`만 있으면: 1콜 3문항까지, 선택지 2~3개(`header` 12자 이내, `id` snake_case, `question`, 추천 라벨 끝 `(Recommended)`). 워커 선택 4지는 1~3번 + "그 밖의 워커는 직접 입력"으로 줄인다.
3. 둘 다 없으면 채팅에 번호 블록(`질문:` / `1. 추천안 — 설명` / ... / `N. 문장으로 직접 알려주기`)으로 묻고 "모르면 1번으로 진행하겠습니다"를 덧붙인다.
4. `codex exec`처럼 사람이 답할 수 없는 실행이면 묻지 않고 추천안(기본값)으로 진행하고 가정을 기록한다.

## 호스트 = Codex, 중첩 호출 주의

- 시작할 때 `--host codex`를 준다(또는 `PUMASI_HOST=codex`). 이 호스트의 기본 워커는 Claude Code(`claude --print --permission-mode acceptEdits`)다.
- 워커로 Codex를 쓰려면 사용자가 지명했거나 task/`defaults.command`에 명시한 경우만이다. 그때 Codex 세션이 `codex exec`를 자식으로 띄우는 구조가 되므로, 워커에게는 브리프 하나만 주고 품앗이를 다시 호출하거나 팀을 만들지 말라고 브리프에 적는다.
- 워커 스폰은 `node <플러그인 루트>/skills/pumasi/scripts/pumasi-job.js start --host codex ...`로 한다. Bash 래퍼는 필요 없다. `spawn_agent`로 직접 띄우는 것은 이 스킬이 요구하지 않는다.
- `--output-schema`·`-o`는 Codex 워커 전용이다. 다른 CLI에 넘기지 않는다.
- 첫 실행 설정(`setup/setup.sh`)은 Claude Code 전용이다. Codex에서는 실행하지 않는다.
- 이 스킬은 `Skill`·`Task` 도구에 기대지 않는다. 다른 스킬(`image` 등)이 필요하면 그 SKILL.md를 열어 따른다.
