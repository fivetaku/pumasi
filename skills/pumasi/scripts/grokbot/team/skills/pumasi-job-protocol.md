---
name: 품앗이 job 프로토콜
description: Use when a message starts with `JOB <id>` from Claude Code (품앗이), or when you are a 품앗이 team bot handed a step of such a job. Defines the plan file, phased parallel/sequential delegation, status file, outputs, verification, and the final JOB_DONE line.
---

# 품앗이 job 프로토콜

Claude Code(품앗이)가 Grok Bot 팀에 일을 맡길 때 쓰는 계약이다. 지휘 봇은 "품앗이", 단계 담당은 품앗이-리서치·품앗이-브라우저·품앗이-코딩·품앗이-검증·품앗이-정리다.

## 1. 받는 지시 형식

```
JOB <id>
goal: 목표와 완료 기준
deliverables: 산출물 목록
constraints: 금지 행동, 읽기 전용 범위
context: 참고 경로·키워드
deadline: 시각(KST) 또는 최대 소요
budget: 최대 봇 수, cloud agent 허용 여부
approval: auto | ask-owner
```

빠진 필드는 보수적으로 해석한다(budget 없으면 봇 3개·cloud agent 1개, approval 없으면 ask-owner).

## 2. 지휘 봇: 계획 (Bot orchestration plan 스킬을 따르되 아래가 우선)

`/workspace/jobs/<id>/plan.md`에 단계(phase)를 쓴다. 각 단계는:
- 담당 봇 1개(품앗이 팀 봇만. 개인 비서 봇은 쓰지 않는다)
- 입력, 기대 산출물, 선행 단계(없으면 병렬)

전형적인 흐름: 조사·브라우저·코딩 단계 병렬 → 품앗이-검증 → (실패 시 해당 단계 1회 재지시) → 품앗이-정리.
검증 단계는 생략하지 않는다.

## 3. 지휘 봇: 실행

- 병렬 단계는 한꺼번에 SendToAgent로 보낸다. 선행이 있는 단계는 앞 결과가 온 뒤에 보낸다.
- 위임 메시지는 자기완결적으로: `JOB <id> step <n>`, 할 일, 입력 경로, 산출물 경로, 금지 행동.
- 결과를 서로 보며 토론이 필요할 때만 "품앗이 리뷰룸" 그룹을 쓴다. 작업 분배에는 그룹을 쓰지 않는다.
- `/workspace/jobs/<id>/status.json`을 단계가 바뀔 때마다 갱신한다:
  `{"job":"<id>","steps":[{"n":1,"owner":"품앗이-리서치","state":"todo|running|done|failed|blocked","out":"경로"}],"updatedAt":"ISO"}`
- 하위 봇이 멈추거나 실패하면 재지시 1회, 그래도 안 되면 failed로 적고 다음으로 간다. 단계를 조용히 버리지 않는다.

## 4. 단계 담당 봇

- 작업 디렉터리 `/workspace/jobs/<id>/<봇이름>/`, 산출물 `/workspace/mailbox/out/<id>/<봇이름>/`만 쓴다. 다른 봇 폴더는 읽기만 한다.
- 끝나면 지휘 봇에게 한 메시지로: 결과 요약 3줄, 산출물 경로, 막힌 점.
- git 작업 브랜치명은 job id. 머지·배포·삭제·외부 발송·결제는 하지 않는다.
- sshd·tailscale·다른 봇 프로세스를 재시작하지 않는다. 브라우저 작업은 한 번에 하나.

## 5. 스스로 정하기와 승인

job은 Claude Code가 보낸 자동 작업이고 오너는 화면 앞에 없다. 그래서:
- 방법·범위·순서·도구·출처 선택처럼 되돌릴 수 있는 결정은 묻지 말고 가장 보수적인 기본값을 골라 진행한다. 고른 가정은 plan.md와 SUMMARY.md에 한 줄로 남긴다.
- job 중에는 오너에게 선택지 위젯이나 질문을 띄우지 않는다. 하위 봇의 질문도 지휘 봇이 답한다.
- 오너 승인 카드는 결제, 외부 발송, 머지·배포·삭제, 봇 생성, 개인 계정·로그인 사용에만 띄운다. approval 값과 무관하다. 그 단계만 blocked로 두고 다른 단계는 계속 진행한다.

## 6. 닫기 (지휘 봇)

1. `/workspace/mailbox/out/<id>/MANIFEST.json`: `[{"path":..., "bot":..., "sha256":..., "kind":"file|pr|url"}]`
2. `/workspace/mailbox/out/<id>/SUMMARY.md`: 결과, 단계별 판정, 미완료와 이유.
3. Claude에게 보내는 마지막 메시지의 맨 끝 줄에 정확히:

```
JOB_DONE <id> status=ok|partial|failed steps=<완료>/<전체> out=/workspace/mailbox/out/<id>/
```

이 줄은 모든 단계가 done·failed·blocked로 확정된 뒤에만 쓴다. 진행 중 보고에는 절대 쓰지 않는다.
