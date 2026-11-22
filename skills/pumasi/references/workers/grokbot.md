# Grok Bot 팀 워커 (`grokbot`)

SKILL.md의 "외주 워커" 표에서 옮긴 상세다. 조사·출처·브라우저·문서 작업용이며 로컬 레포는 고치지 않는다.

품앗이에 번들된 브릿지 `skills/pumasi/scripts/grokbot/grokbot.mjs`가 데스크톱 앱 세션을 재사용해 Grok Bot에 job을 보낸다.
지휘 봇 "품앗이"가 공용 스킬 "품앗이 job 프로토콜"대로 하위 봇에 나눠 맡기고 `JOB_DONE` 줄로 닫는다.
비공식·비문서 내부 API라 앱 업데이트로 깨질 수 있다(공식 채팅 API 없음).

준비 1회 (Claude가 실행, `$GB`는 브릿지 절대경로 — `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/scripts/grokbot/grokbot.mjs`를 셸에서 풀어 쓴다):
```bash
node "$GB" status                  # app·session 이 true 여야 한다 (맥 전용, Grok Bot 앱 로그인 필요)
node "$GB" team plan               # 팀이 없으면 create 목록이 나온다
node "$GB" team apply --admin      # 사용자가 Phase 0.5에서 Grok Bot을 고른 것이 생성 동의다. 이미 있으면 갱신만
```
첫 실행 때 macOS가 "Grok Bot Safe Storage" 키체인 접근 허용 창을 띄운다 — 사용자에게 "허용"을 눌러 달라고 한 줄로 알린다.

config (task별):
```yaml
    - name: market-research
      command: "node /abs/path/to/grokbot.mjs run --text --queue --partial-ok --timeout 3000 --dest .pumasi/grokbot/market-research"
      instruction: |
        목표·완료 기준·산출물을 쓴다(웹 조사·문서 위주). 로컬 파일 경로는 Grok Bot이 볼 수 없다.
      gates:
        - name: "요약 회수"
          command: "[ -f .pumasi/grokbot/market-research/SUMMARY.md ]"
```
- `command`의 경로는 config를 쓸 때 **절대경로로 풀어** 넣는다(yaml은 환경변수를 펼치지 않는다).
- 프롬프트는 마지막 positional 인자로 전달된다(품앗이 규격 그대로). `--text`면 output.txt에 최종 보고 + `[grokbot] state=… job=… dest=…` 줄이 남는다.
- 종료 코드: 0 성공(회수·해시 검증 통과) · 3 사람 응답 대기 · 4 진행 중(재접속: `node "$GB" watch <job>`) · 5 partial · 6 failed · 7 취소 · 8 회수 실패.
- 지휘 봇 하나는 job을 한 번에 하나만 받는다. 팀은 `team.json`의 `lanes`(기본 3)만큼 여러 벌 있고(레인 2부터 이름 끝에 `#2`·`#3`), `run`은 장부·봇 상태로 빈 레인을 골라 잡으므로 여러 세션·같은 라운드의 Grok Bot task가 서로 섞이지 않는다. 레인이 다 차면 `--queue`로 차례를 기다린다. 특정 레인만 쓰려면 `--bot 품앗이#2`.
- Grok Bot 앱은 봇 이름을 "이름 · 타이틀"로 합쳐 저장한다. 브릿지는 이 형태를 풀어 비교하므로 `team apply`를 반복해도 봇이 다시 생기지 않는다. 같은 이름이 여럿이면(과거 중복 생성) 가장 오래된 봇이 정본이고 나머지는 `extra`로 표시된다 — `team apply --prune --admin`으로 지운다.
- `--timeout`은 품앗이 `settings.timeout`(기본 3600초)보다 작게 둔다.
- `--partial-ok`(권장): 지휘 봇이 partial로 닫아도 산출물 회수·해시 검증이 통과하면 종료 코드 0으로 끝낸다. 그래야 품앗이 게이트가 건너뛰지 않고 내용을 직접 판정한다. output.txt 끝의 `[grokbot] state=partial` 줄로 partial이었다는 사실은 남는다.
- 산출물 회수: `--dest` 폴더로 받아 MANIFEST(JSON 배열 또는 `{files:[...]}`) 해시를 맥에서 다시 계산해 대조한다. 해시로 검증된 파일이 0개면 실패다.
  - `~/.grokbot/config.json`에 `{"ssh":"user@host"}`(Grok Bot VM으로 가는 SSH, 예: Tailscale)가 있으면 SSH로 받는다.
  - 없거나 SSH가 안 되면 **대화 회수**: 지휘 봇에게 파일을 base64로 메시지에 실어 보내게 하고 받는다(약 1분, 전체 400KB 이하. 넘으면 MANIFEST·SUMMARY.md만). 직접 실행은 `node "$GB" fetch <job> --chat --dest <dir>`.
- 점검: `node "$GB" doctor` — 앱 버전, 세션 파일 형식, RPC 응답 모양(완료 판정에 쓰는 필드 포함), 팀 선언 일치, 회수 채널을 읽기 전용으로 확인한다. 앱 업데이트 뒤나 job이 이상하게 끝날 때 먼저 돌린다.
- 하지 않는 일: 로컬 레포 수정(코드는 Codex task로), 결제·발송·머지·배포·삭제(프로토콜이 차단, 필요하면 그 단계만 blocked).
- 개인 비서 봇과 같은 VM을 쓰므로 품앗이 팀은 공개 웹 조사·정리 위주로 쓴다. 개인 계정 로그인 작업은 승인 카드 대상이다.
- 회귀 확인: `node skills/pumasi/scripts/grokbot/test-offline.mjs`.
