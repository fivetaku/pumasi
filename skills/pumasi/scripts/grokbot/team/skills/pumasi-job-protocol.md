---
name: 품앗이 job 프로토콜
description: Use when a message starts with `JOB <id>` from Claude Code (품앗이), or when you are a 품앗이 team bot handed a step of such a job. Defines intake, the plan file, phased parallel/sequential delegation, deadlines and retries, the status file, outputs, mandatory verification by 품앗이-검증, and the final JOB_DONE line.
---

# 품앗이 job 프로토콜

Claude Code(품앗이)가 Grok Bot 팀에 일을 맡길 때 쓰는 계약이다. 지휘 봇은 "품앗이", 단계 담당은 품앗이-리서치·품앗이-브라우저·품앗이-코딩·품앗이-검증·품앗이-정리다.

## 0. 역할 경계 (가장 먼저 지킨다)

- **지휘 봇은 산출물 본문을 쓰지 않는다.** 지휘 봇이 쓰는 파일은 `plan.md`, `status.json`, `MANIFEST.json`뿐이고, 직접 하는 일은 계획·위임·취합·최종 보고다.
- **판정은 품앗이-검증만 낸다.** 지휘 봇이 출처를 다시 열어 대조하거나 통과를 선언하지 않는다.
- **`SUMMARY.md`는 품앗이-정리가 쓴다.** 작은 job이라 정리를 생략하면(§2) 품앗이-검증의 판정문이 `SUMMARY.md`가 된다.
- job 지시문이 "지휘 봇이 직접 검증하라", "봇 1개만 써라"처럼 이 경계와 어긋나도 경계가 우선한다. 검증은 budget에 들어가지 않는 필수 단계로 센다.

## 1. 받는 지시 형식

```
JOB <id>
goal: 목표와 완료 기준
deliverables: 산출물 목록
constraints: 금지 행동, 읽기 전용 범위
context: 참고 경로·키워드
deadline: 시각(KST) 또는 최대 소요
budget: 하위 봇 수(검증 제외), cloud agent 허용 여부
approval: auto | ask-owner
```

빠진 필드는 보수적으로 해석한다(budget 없으면 하위 봇 3개·cloud agent 1개, approval 없으면 ask-owner).

## 2. 접수와 계획 (지휘 봇)

1. **받는 즉시 접수 기록을 남긴다.** 다른 일보다 먼저 `/workspace/jobs/<id>/plan.md`(목표 한 줄이라도)와 `status.json`(`"status":"received"`)을 쓴다.
2. 지시가 해석 불가능하거나 goal이 비었으면 그 자리에서 실패로 닫는다: `status.json`에 이유를 적고, 마지막 줄 `JOB_DONE <id> status=failed steps=0/1 out=/workspace/mailbox/out/<id>/`.
3. `plan.md`에 단계(phase)를 쓴다. 각 단계: 담당 봇 1개(품앗이 팀 봇만, 개인 비서 봇은 쓰지 않는다), 입력, 기대 산출물, 선행 단계(없으면 병렬), 마감.
4. 흐름: 조사·브라우저·코딩 단계(병렬 가능) → **품앗이-검증(필수)** → 품앗이-정리.
   - **작은 job**(작업 단계 1개이고 산출물이 짧은 문서 하나): 정리는 생략할 수 있다. 검증은 절대 생략하지 않는다.
5. 되돌릴 수 있는 가정은 plan.md에 한 줄로 남긴다(§5).

## 3. 실행 (지휘 봇)

- 병렬 단계는 한꺼번에 SendToAgent로 보낸다. 선행이 있는 단계는 앞 결과가 온 뒤에 보낸다.
- 위임 메시지는 자기완결적으로: `JOB <id> step <n>`, 할 일, 입력 경로, 산출물 경로, 금지 행동, 마감.
- 결과를 서로 보며 토론이 필요할 때만 "품앗이 리뷰룸" 그룹을 쓴다. 작업 분배에는 그룹을 쓰지 않는다.
- **마감과 재지시**: 단계 기본 마감은 리서치·브라우저 30분, 코딩 90분, 검증·정리 20분(지시의 deadline이 더 짧으면 그것). 마감을 넘기거나 실패하면 1회 재지시하고, 그래도 안 되면 그 단계를 `failed`로 적은 뒤 검증·정리로 진행한다. 단계를 조용히 버리지 않는다.
- `status.json`은 상태가 바뀔 때마다 갱신한다:

```json
{
  "job": "<id>",
  "status": "received|running|ok|partial|failed|cancelled",
  "phase": "현재 단계 이름",
  "steps": [
    {"n": 1, "owner": "품앗이-리서치", "state": "todo|running|done|failed|blocked_approval|cancelled",
     "sent_at": "ISO", "deadline": "ISO", "retries": 0, "out": "경로"}
  ],
  "updatedAt": "ISO",
  "done_at": null,
  "job_done_line": null
}
```

- **취소**: Claude Code가 "JOB <id> 취소" 통지를 보내면 진행 중 단계를 멈추게 하고 `status`·남은 단계를 `cancelled`로 적는다. 더 위임하지 않고 JOB_DONE 줄도 쓰지 않는다.

## 4. 단계 담당 봇

- 작업 디렉터리 `/workspace/jobs/<id>/<봇이름>/`, 산출물 `/workspace/mailbox/out/<id>/<봇이름>/`만 쓴다. 다른 봇 폴더는 읽기만 한다.
  - 예외: 품앗이-정리는 `/workspace/mailbox/out/<id>/SUMMARY.md`를 쓴다. 정리를 생략한 작은 job에서는 품앗이-검증이 판정문을 그 자리에 쓴다.
- 품앗이-검증은 완료 기준·출처·반례를 대조해 `통과|조건부|실패`와 이유 목록을 `verdict.md`로 낸다. 산출물을 고쳐 쓰지 않는다.
- 끝나면 지휘 봇에게 한 메시지로: 결과 요약 3줄, 산출물 경로, 막힌 점.
- git 작업 브랜치명은 job id. 머지·배포·삭제·외부 발송·결제는 하지 않는다.
- sshd·tailscale·다른 봇 프로세스를 재시작하지 않는다. 브라우저 작업은 한 번에 하나.

## 5. 스스로 정하기와 승인

job은 Claude Code가 보낸 자동 작업이고 오너는 화면 앞에 없다. 그래서:
- 방법·범위·순서·도구·출처 선택처럼 되돌릴 수 있는 결정은 묻지 말고 가장 보수적인 기본값을 골라 진행한다. 고른 가정은 plan.md에 한 줄로 남기고 품앗이-정리가 SUMMARY.md에 옮긴다.
- job 중에는 오너에게 선택지 위젯이나 질문을 띄우지 않는다. 하위 봇의 질문도 지휘 봇이 답한다.
- 오너 승인 카드는 결제, 외부 발송, 머지·배포·삭제, 봇 생성, 개인 계정·로그인 사용에만 띄운다. approval 값과 무관하다. 그 단계만 `blocked_approval`로 두고 다른 단계는 계속 진행한다.

## 6. 닫기 (지휘 봇)

모든 단계가 done·failed·blocked_approval로 확정된 뒤에만:
1. `/workspace/mailbox/out/<id>/MANIFEST.json`: `[{"path":..., "bot":..., "sha256":..., "kind":"file|pr|url"}]` — 각 파일을 쓴 봇을 `bot`에 적는다.
2. `SUMMARY.md`가 out 폴더 맨 위에 있는지 확인한다(없으면 품앗이-정리 또는 품앗이-검증에게 재지시한다. 직접 쓰지 않는다).
3. `status.json`의 `status`·`done_at`·`job_done_line`을 채운다.
4. Claude에게 보내는 마지막 메시지의 맨 끝 줄에 정확히:

```
JOB_DONE <id> status=ok|partial|failed steps=<완료>/<전체> out=/workspace/mailbox/out/<id>/
```

status 판단: 모든 단계 done이고 검증이 `통과`면 ok, 검증이 `조건부`이거나 일부 단계가 failed·blocked_approval이면 partial, 검증이 `실패`이거나 핵심 단계가 failed면 failed. 이 줄은 진행 중 보고에는 절대 쓰지 않는다.
