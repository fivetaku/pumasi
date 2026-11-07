#!/usr/bin/env python3
"""pumasi:image web 백엔드 — ChatGPT 웹(로그인된 구독 세션)으로 이미지·애니메이션 GIF를 생성해 저장한다.

왜 있나: Codex 내장 이미지 도구는 인자가 prompt·참조 이미지·투명 배경뿐이라 GIF/SVG 같은
출력 형식을 고를 수 없다(codex-cli 0.167 실측 2026-11-08 — GIF 요청에 "출력할 수 없습니다"로 거부).
ChatGPT 웹은 최신 이미지 모델이 먼저 들어오는 표면이고 애니메이션 GIF도 생성된다(같은 날 실측:
8프레임·150ms 요청 그대로). 웹을 자동화하면 구독 한계비용 0으로 이 기능을 쓸 수 있다.

모델 판별: C2PA softwareAgent 는 2026-11 기준 웹·Codex 모두 name=ChatGPT, version=gpt-image 로만
찍혀 버전을 가를 수 없다. 그래서 기대 모델 비교는 하지 않고 판독값을 그대로 보고한다.

브라우저 자동화 코어(브라우저 기동·CDP 연결·다이얼로그 가드·로그인 판정·Chat 모드 강제·컴포저 입력·
전송·URL 포착)는 같은 폴더의 chatgpt_web_core.py 다 — insane-review 의 pack_and_ask.py 에서 필요한
부분만 벤더링했으므로 insane-review 설치가 필요 없다. 포트·프로필은 insane-review(9222)와 격리된
전용 인스턴스(기본 9224)를 쓴다 — 두 자동화가 같은 브라우저의 탭 상태를 경합하지 않게 하기 위해서다.

exit code: 0 저장 완료  2 사용법 오류  3 사람 필요(로그인/브라우저)
           4 모드·전송 실패·동시 실행 락 대기 초과  5 타임아웃·이미지 없음·회수 실패
           6 정책 거부(텍스트만 응답)  7 쿼터·한도 차단
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import json
import os
import struct
import sys
import time
from datetime import datetime
from pathlib import Path


def _env(name: str, default: str | None = None) -> str | None:
    """PUMASI_IMAGE_WEB_* 우선, 구 insane-image-web 의 INSANE_IMAGE_WEB_* 도 받는다(이관 호환)."""
    return os.environ.get(f"PUMASI_IMAGE_WEB_{name}") or os.environ.get(f"INSANE_IMAGE_WEB_{name}") or default


def _state_dir() -> Path:
    explicit = _env("HOME")
    if explicit:
        return Path(explicit).expanduser()
    new = Path.home() / ".pumasi-image-web"
    legacy = Path.home() / ".insane-image-web"
    # 구 insane-image-web 전용 프로필에 이미 로그인돼 있으면 그대로 이어 쓴다(재로그인 강요 방지)
    if not new.exists() and (legacy / "browser-profile").exists():
        return legacy
    return new


STATE_DIR = _state_dir()
CDP_PORT: str = _env("CDP_PORT") or "9224"

# --- 브라우저 코어(chatgpt_web_core, insane-review 에서 벤더링)를 격리 설정으로 import ----------
# 코어는 모듈 로드 시 PUMASI_WEB_CORE_* 환경변수를 읽어 상수를 굳히므로 import 전에 채운다.
os.environ["PUMASI_WEB_CORE_CDP_PORT"] = CDP_PORT
os.environ["PUMASI_WEB_CORE_PROFILE"] = str(STATE_DIR / "browser-profile")
os.environ["PUMASI_WEB_CORE_CONFIG"] = str(STATE_DIR / "config.json")
os.environ["PUMASI_WEB_CORE_OUT"] = str(STATE_DIR)
_LAUNCH_MODE = _env("LAUNCH_MODE")
if _LAUNCH_MODE:
    os.environ["PUMASI_WEB_CORE_LAUNCH_MODE"] = _LAUNCH_MODE


def log(msg: str) -> None:
    print(msg, flush=True)


sys.path.insert(0, str(Path(__file__).resolve().parent))
import chatgpt_web_core as pa  # noqa: E402
from c2pa_model import read_software_agent  # noqa: E402

# --- 상수 ------------------------------------------------------------------------
PROMPT_PREFIX = ("Create exactly one image now. Do not ask clarifying questions and do not reply with text only. "
                 "Image description:\n\n")
REJECT_HINTS = ("만들 수 없", "생성할 수 없", "도와드릴 수 없", "출력할 수 없", "can't create", "cannot create",
                "can't help", "unable to generate", "content policy", "정책")
STABLE_POLLS = 2          # 완료 판정 후 같은 이미지가 이 횟수만큼 연속 관측돼야 회수
TEXT_IDLE_SECS = 25       # 이미지 없이 텍스트만 이 시간 동안 변화 없으면 턴 종료로 본다

# 턴 상태 판독. 두 세대 DOM 모두 지원한다.
#  - 2026-11 UI(실측): 턴 = div[data-chatgpt-search-message-ids], 사용자 턴은 class 에 group/user-message.
#    생성 이미지는 [data-testid=generated-image-gallery] 안의 blob: img(alt "생성된 이미지 N"/"N번째 생성 GIF"),
#    완료되면 그 이미지의 "… 편집"/"… 공유" 버튼이 붙는다. copy-turn-action-button 은 사라졌다.
#  - 2026-09 UI: section[data-turn=assistant], 이미지 = img[src*=backend-api/estuary/content],
#    완료 = copy-turn-action-button.
JS_TURN_STATE = r"""
() => {
  const isUser = n => /user-message/.test((n.className || '').toString())
    || n.getAttribute('data-turn') === 'user' || !!n.querySelector('[data-message-author-role="user"]');
  let turns = [...document.querySelectorAll('[data-chatgpt-search-message-ids]')];
  let legacy = false;
  if (!turns.length) { turns = [...document.querySelectorAll('section[data-turn], article[data-turn]')]; legacy = true; }
  if (!turns.length) return {present:false};
  const last = turns[turns.length - 1];
  if (isUser(last)) return {present:false, waiting_assistant:true};
  const ids = (last.getAttribute('data-chatgpt-search-message-ids') || '').split(/\s+/).filter(Boolean)
    .concat([...last.querySelectorAll('[data-message-id]')].map(e => e.getAttribute('data-message-id')));
  const imgEls = [...last.querySelectorAll('img')].filter(i => {
    const s = i.currentSrc || i.src || '';
    const alt = (i.alt || '');
    if (/미리 ?보기|preview/i.test(alt)) return false;
    return s.startsWith('blob:') || s.includes('backend-api/estuary/content');
  });
  const imgs = imgEls.map(i => ({src: i.currentSrc || i.src, alt: i.alt || '', w: i.naturalWidth, h: i.naturalHeight,
                                 complete: i.complete}));
  // 완료 신호: 턴 액션(다시 시도·좋아요/싫어요)이 붙거나, 이미지별 공유/편집 버튼이 붙는다.
  // 버튼은 턴 노드 바깥 조상에 달리므로 최대 4단계 위까지 본다(실측: PNG "생성된 이미지 1 공유",
  // GIF "이 GIF 공유" + 3단계 위 "다시 시도"/"이 GIF에 좋아요 표시").
  const TURN_ACTION = /다시 시도|좋아요|싫어요|retry|try again|good response|bad response|thumbs/i;
  let scope = last, labels = [], turnAction = false;
  for (let k = 0; k < 4 && scope; k++) {
    labels = [...scope.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label') || '');
    if (labels.some(l => TURN_ACTION.test(l))) { turnAction = true; break; }
    scope = scope.parentElement;
  }
  const perImage = imgs.length > 0 && imgs.every(x => labels.some(l =>
    (x.alt && l.startsWith(x.alt) && /공유|편집|share|edit/i.test(l.slice(x.alt.length))) ||
    /^(이 GIF|this gif).*(공유|share)/i.test(l)));
  const imgDone = imgs.length > 0 && imgs.every(x => x.complete && x.w > 0) && (turnAction || perImage);
  const legacyDone = !!last.querySelector('[data-testid="copy-turn-action-button"], [data-testid$="-turn-action-button"]');
  return {present:true, legacy, ids, imgs, gallery: !!last.querySelector('[data-testid="generated-image-gallery"]'),
          terminal: imgDone || legacyDone || (turnAction && !imgs.length), text:(last.innerText || '').slice(0, 400)};
}
"""

JS_FETCH_BLOB = r"""
async (src) => {
  const r = await fetch(src);
  const bl = await r.blob();
  const buf = new Uint8Array(await bl.arrayBuffer());
  let s = '';
  for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
  return {type: bl.type, b64: btoa(s)};
}
"""


# --- 유틸 ------------------------------------------------------------------------
def sniff_ext(raw: bytes) -> str:
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    if raw[:2] == b"\xff\xd8":
        return "jpg"
    if raw.lstrip()[:5] in (b"<?xml", b"<svg ") or raw.lstrip()[:4] == b"<svg":
        return "svg"
    return "bin"


def image_dims(raw: bytes) -> str:
    if raw[:8] == b"\x89PNG\r\n\x1a\n" and raw[12:16] == b"IHDR":
        w, h = struct.unpack(">II", raw[16:24])
        return f"{w}x{h}"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", raw[6:10])
        return f"{w}x{h}"
    return "(unmeasured)"


def gif_frame_count(raw: bytes) -> int | None:
    """GIF 이미지 디스크립터(0x2C) 개수 — 블록 구조를 따라가며 센다(LZW 데이터 안의 0x2C 오탐 방지)."""
    if raw[:6] not in (b"GIF87a", b"GIF89a"):
        return None
    i = 13
    flags = raw[10]
    if flags & 0x80:
        i += 3 * (2 ** ((flags & 0x07) + 1))
    frames = 0
    try:
        while i < len(raw):
            b = raw[i]
            if b == 0x3B:  # trailer
                break
            if b == 0x21:  # extension: 0x21 label sub-blocks...
                i += 2
                while raw[i] != 0:
                    i += raw[i] + 1
                i += 1
            elif b == 0x2C:  # image descriptor
                frames += 1
                lflags = raw[i + 9]
                i += 10
                if lflags & 0x80:
                    i += 3 * (2 ** ((lflags & 0x07) + 1))
                i += 1  # LZW min code size
                while raw[i] != 0:
                    i += raw[i] + 1
                i += 1
            else:
                break
    except IndexError:
        pass
    return frames


def write_manifest(path: Path, data: dict) -> None:
    data = {**data, "updated_at": datetime.now().astimezone().isoformat()}
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


class RunLock:
    """자기 자신 동시 실행 배제(전용 브라우저의 탭 상태 경합 방지). insane-review 와는 포트가 달라 무관."""

    def __init__(self, timeout: int = 600):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.fh = open(STATE_DIR / "run.lock", "a+")
        self.timeout = timeout

    def __enter__(self):
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.monotonic() > deadline:
                    raise TimeoutError("다른 web 백엔드 실행이 락을 놓지 않음")
                time.sleep(2)

    def __exit__(self, *a):
        try:
            fcntl.flock(self.fh, fcntl.LOCK_UN)
        finally:
            self.fh.close()


# --- 핵심 단계 --------------------------------------------------------------------
def open_session(pw, browser_arg: str | None):
    """브라우저 보장 → CDP 연결 → 새 탭 → 로그인 판정. 사람 필요 시 SystemExit(3)."""
    if not pa.ensure_browser(browser_arg):
        log(f"❌ 전용 브라우저를 띄우지 못함 (CDP {pa.CDP_PORT}). --check-env 로 상태를 확인하세요.")
        sys.exit(3)
    browser = pa.connect_cdp(pw)
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    pa._guard_dialogs(ctx)
    page = ctx.new_page()
    pa.hide_browser_if_background()
    page.goto(pa.CHATGPT_URL, wait_until="domcontentloaded")
    state = pa.login_state(page, wait_secs=20)
    if state != "ok":
        log(f"❌ ChatGPT 로그인 상태 = {state}. 전용 프로필(포트 {pa.CDP_PORT})에 로그인이 필요합니다 → "
            f"`webgen.py --login` 으로 창을 띄워 로그인한 뒤 다시 실행하세요.")
        page.close()
        sys.exit(3)
    return ctx, page


def fetch_image(ctx, page, src: str) -> bytes:
    """blob: URL 은 페이지 안에서 fetch 해 base64 로 꺼낸다(2026-11 UI). estuary 서명 URL 은 브라우저
    컨텍스트 쿠키로 직접 GET(2026-09 UI). 둘 다 원본 바이트와 C2PA 를 보존한다."""
    if src.startswith("blob:"):
        r = page.evaluate(JS_FETCH_BLOB, src)
        return base64.b64decode(r["b64"])
    r = ctx.request.get(src, timeout=60000)
    if not r.ok:
        raise RuntimeError(f"image GET {r.status}")
    return r.body()


def save(raw: bytes, out: Path, manifest: dict, manifest_path: Path, extra: dict) -> int:
    ext = sniff_ext(raw)
    if ext == "bin":
        log("❌ 회수한 바이트가 이미지 시그니처가 아님(로그인 리다이렉트 HTML 등 의심)")
        write_manifest(manifest_path, {**manifest, "status": "fetch_not_image"})
        return 5
    if out.suffix.lower().lstrip(".") != ext:
        out = out.with_suffix("." + ext)
        log(f"ℹ️  산출물 포맷이 {ext} — 타깃 확장자를 맞춤")
    agent = read_software_agent(raw) if ext in ("png", "gif", "jpg", "webp") else {"present": False, "label": "(unverified)"}
    frames = gif_frame_count(raw)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    sha1 = hashlib.sha1(raw).hexdigest()
    dims = image_dims(raw)
    write_manifest(manifest_path, {**manifest, **extra, "status": "saved", "path": str(out), "sha1": sha1,
                                   "bytes": len(raw), "format": ext, "dims": dims, "frames": frames, "c2pa": agent})
    log("[webgen] SUCCESS")
    log(f"  path:     {out}")
    log(f"  format:   {ext}" + (f"  ({frames} frames)" if frames is not None else ""))
    log(f"  size:     {len(raw)} bytes")
    log(f"  dims:     {dims}")
    log(f"  sha1:     {sha1}")
    log(f"  model:    {agent['label']}  (C2PA softwareAgent — 2026-11부터 버전 숫자 미기재)")
    log(f"  chat_url: {extra.get('chat_url') or manifest.get('chat_url') or '-'}")
    log(f"  manifest: {manifest_path}")
    return 0


def wait_for_image(page, base_ids: set, max_wait: int) -> tuple[str, dict]:
    """새 assistant 턴이 완료되고 이미지가 안정될 때까지 폴링.
    반환: (status, state) — status ∈ ok | rejected | no_image | timeout | quota."""
    t0 = time.monotonic()
    last_sig = None
    last_change = t0
    stable = 0
    reloaded = False
    while time.monotonic() - t0 < max_wait:
        time.sleep(3)
        q = pa.detect_quota_block(page)
        if q:
            log(f"❌ 쿼터/한도 차단 감지: {q[:120]}")
            return "quota", {"quota_text": q}
        try:
            st = page.evaluate(JS_TURN_STATE)
        except Exception as exc:  # 네비게이션 중 등
            log(f"  … evaluate 실패({str(exc)[:60]}) — 재시도")
            continue
        streaming = pa.is_streaming(page)
        if st.get("present") and not (base_ids and st.get("ids") and set(st["ids"]) <= base_ids):
            sig = json.dumps([[i["src"][:80] for i in st.get("imgs", [])], st.get("terminal"), st.get("text")],
                             sort_keys=True)
            if sig != last_sig:
                last_sig = sig
                last_change = time.monotonic()
                stable = 0
                log(f"  … t+{int(time.monotonic() - t0)}s imgs={len(st.get('imgs', []))} "
                    f"terminal={st.get('terminal')} streaming={streaming}")
            else:
                stable += 1
            if st.get("terminal") and st.get("imgs") and not streaming and stable >= STABLE_POLLS:
                return "ok", st
            # 이미지 없이 텍스트만 남고 조용해지면 거부/무응답으로 판정
            idle = time.monotonic() - last_change
            if not st.get("imgs") and not st.get("gallery") and not streaming and st.get("text") and \
                    (st.get("terminal") or idle > TEXT_IDLE_SECS):
                txt = st.get("text", "")
                kind = "rejected" if any(h.lower() in txt.lower() for h in REJECT_HINTS) else "no_image"
                log(f"❌ 턴이 끝났지만 이미지가 없음 ({kind}): {txt[:200]!r}")
                return kind, st
        # 스톨: 90초 동안 DOM 변화도 스트리밍 표시도 없으면 1회 재로드(스트림 유실 패턴)
        if not reloaded and time.monotonic() - last_change > 90 and not streaming:
            log("  ♻️  90s 무변화 — 스트림 유실 의심, 대화 URL 재로드 1회")
            reloaded = True
            try:
                page.reload(wait_until="domcontentloaded")
            except Exception:
                pass
            last_change = time.monotonic()
    return "timeout", {}


def cmd_generate(args) -> int:
    from playwright.sync_api import sync_playwright

    prompt = Path(args.prompt_file).read_text(encoding="utf-8").strip()
    if not prompt:
        log("ERROR: 프롬프트가 비어 있음")
        return 2
    if len(prompt) > 8000:
        log(f"ERROR: 프롬프트가 너무 김({len(prompt)}자) — 컴포저 한도를 넘을 수 있어 중단(자동 축약은 의미를 바꾸므로 안 함)")
        return 2
    out = Path(args.out).expanduser()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    run_tag = datetime.now().strftime("%Y%m%d_%H%M%S")
    manifest_path = STATE_DIR / f"manifest_{run_tag}_{hashlib.sha1(prompt.encode()).hexdigest()[:6]}.json"
    manifest = {"run_tag": run_tag, "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "prompt_preview": prompt[:200], "target": str(out),
                "status": "starting", "created_at": datetime.now().astimezone().isoformat()}
    write_manifest(manifest_path, manifest)

    with RunLock(), sync_playwright() as pw:
        ctx, page = open_session(pw, args.browser)
        try:
            ok, mode = pa.ensure_chat_mode(page)
            if not ok:
                log(f"❌ Chat 모드 보정 실패(현재 {mode}) — Work 모드는 모델 라인업이 달라 fail-closed")
                write_manifest(manifest_path, {**manifest, "status": "mode_failed", "mode": mode})
                return 4
            base_ids = pa.msg_id_set(page)
            full_text = PROMPT_PREFIX + prompt
            pa.put_text(page, full_text)
            # composer_has_prompt 는 '전체 동일성' 검증(잘림·중복·오염 모두 거부)이므로 넣은 텍스트 전체를 넘긴다
            if not pa.composer_has_prompt(page, full_text):
                log(f"❌ 컴포저 텍스트가 프롬프트와 불일치(잘림/중복/오염) — 현재 {len(pa.read_composer_text(page))}자")
                pa.clear_composer(page)
                write_manifest(manifest_path, {**manifest, "status": "compose_failed"})
                return 4
            pa.click_send(page)
            chat_url = pa.capture_conv_url(page, timeout_secs=30)
            manifest["chat_url"] = chat_url
            write_manifest(manifest_path, {**manifest, "status": "sent"})
            log(f"  🧾 전송 완료 — chat_url={chat_url or '(미포착)'} manifest={manifest_path.name}")

            status, st = wait_for_image(page, base_ids, args.max_wait)
            if status != "ok":
                write_manifest(manifest_path, {**manifest, "status": status, "turn_text": st.get("text"),
                                               **({"quota_text": st.get("quota_text")} if st.get("quota_text") else {})})
                if status == "timeout":
                    log(f"❌ {args.max_wait}s 안에 이미지 턴이 완료되지 않음 — `webgen.py --harvest {chat_url or manifest_path}` 로 회수 시도 가능")
                    return 5
                return {"rejected": 6, "no_image": 5, "quota": 7}[status]
            src = st["imgs"][-1]["src"]
            try:
                raw = fetch_image(ctx, page, src)
            except Exception as exc:
                log(f"❌ 이미지 회수 실패({str(exc)[:120]}) — `webgen.py --harvest {chat_url}` 로 다시 회수하세요")
                write_manifest(manifest_path, {**manifest, "status": "fetch_failed", "error": str(exc)[:300]})
                return 5
            return save(raw, out, manifest, manifest_path, {"chat_url": chat_url, "image_src": src[:200]})
        finally:
            try:
                page.close()
            except Exception:
                pass


def cmd_harvest(args) -> int:
    """중단된 실행 회수: manifest 경로 또는 대화 URL 을 받아 마지막 assistant 이미지를 다시 받는다."""
    from playwright.sync_api import sync_playwright

    target = args.harvest
    manifest: dict = {}
    manifest_path: Path
    if target.startswith("http"):
        chat_url = target
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        manifest_path = STATE_DIR / f"manifest_harvest_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    else:
        manifest_path = Path(target).expanduser()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        chat_url = manifest.get("chat_url") or ""
    if not chat_url:
        log("ERROR: 회수할 chat_url 이 없음")
        return 2
    out = Path(args.out or manifest.get("target") or (STATE_DIR / "harvest.png")).expanduser()
    with RunLock(), sync_playwright() as pw:
        ctx, page = open_session(pw, args.browser)
        try:
            page.goto(chat_url, wait_until="domcontentloaded")
            st: dict = {}
            last_sig, stable, done = None, 0, False
            for _ in range(15):  # blob 이미지는 대화 로드 후 늦게 붙는다 — 최대 ~45초 대기
                time.sleep(3)
                try:
                    st = page.evaluate(JS_TURN_STATE)
                except Exception:
                    continue  # SPA 내비게이션 중 컨텍스트 파괴 — 다음 폴링에서 재시도
                ready = st.get("present") and st.get("imgs") and all(i["w"] > 0 for i in st["imgs"])
                sig = json.dumps([[i["src"][:80] for i in st.get("imgs", [])], st.get("terminal")])
                stable = stable + 1 if (ready and sig == last_sig) else 0
                last_sig = sig
                if ready and st.get("terminal") and stable >= 1:
                    done = True
                    break
            if not st.get("present") or not st.get("imgs"):
                log("❌ 대화에서 assistant 이미지 턴을 찾지 못함")
                return 5
            if not done:
                if pa.is_streaming(page):
                    log("❌ 아직 생성 중인 대화 — 완료된 뒤 다시 --harvest 하세요")
                    return 5
                log("⚠️  완료 신호(턴 액션 버튼)를 확인하지 못했지만 스트리밍이 끝났고 이미지가 있어 회수합니다")
            src = st["imgs"][-1]["src"]
            try:
                raw = fetch_image(ctx, page, src)
            except Exception as exc:
                log(f"❌ 이미지 회수 실패({str(exc)[:120]})")
                return 5
            return save(raw, out, {**manifest, "chat_url": chat_url}, manifest_path,
                        {"chat_url": chat_url, "harvested": True})
        finally:
            page.close()


def cmd_check_env(args) -> int:
    ok = True
    log(f"state_dir={STATE_DIR}")
    try:
        import playwright  # noqa: F401
        log("playwright=ok")
    except ImportError:
        log("playwright=MISSING (pip install playwright)")
        ok = False
    log(f"cdp_port={pa.CDP_PORT} port_open={pa.is_port_open()} cdp_ok={pa.cdp_browser_ok() if pa.is_port_open() else False}")
    log(f"profile={pa.BROWSER_PROFILE_DIR} exists={pa.BROWSER_PROFILE_DIR.exists()}")
    log(f"config={pa.CONFIG_PATH} launch_mode={pa.get_launch_mode()}")
    r = pa.resolve_browser(args.browser)
    log(f"browser={r[0] if r else 'NONE'} path={r[1] if r else '-'}")
    if args.probe_login:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            if not pa.ensure_browser(args.browser):
                log("login=browser_unavailable")
                return 3
            b = pa.connect_cdp(pw)
            ctx = b.contexts[0]
            pg = ctx.new_page()
            pa.hide_browser_if_background()
            pg.goto(pa.CHATGPT_URL, wait_until="domcontentloaded")
            st = pa.login_state(pg, wait_secs=20)
            log(f"login={st} mode={pa.read_mode(pg)}")
            pg.close()
            if st != "ok":
                return 3
    return 0 if ok else 3


def cmd_login(args) -> int:
    """사람이 보는 창으로 전용 프로필을 띄워 로그인하게 한다(이때만 foreground).
    이미 백그라운드 모드로 떠 있으면 창이 안 보이므로, 그 사실과 재기동 방법을 알린다."""
    os.environ["PUMASI_WEB_CORE_LAUNCH_MODE"] = "foreground"
    if pa.is_port_open():
        log(f"ℹ️  포트 {pa.CDP_PORT} 브라우저가 이미 떠 있음 — 창이 보이면 거기서 chatgpt.com 에 로그인하세요. "
            f"백그라운드로 떠서 창이 안 보이면 그 브라우저(--remote-debugging-port={pa.CDP_PORT})를 종료한 뒤 "
            f"`webgen.py --login` 을 다시 실행하세요.")
        return 0
    if not pa.ensure_browser(args.browser):
        return 3
    log(f"✅ 전용 브라우저(포트 {pa.CDP_PORT})를 띄웠습니다. 그 창에서 https://chatgpt.com 에 로그인한 뒤 다시 실행하세요.")
    return 0


def _run(fn, args) -> int:
    try:
        return fn(args)
    except TimeoutError as exc:  # RunLock: 다른 실행이 전용 브라우저를 쓰는 중
        log(f"❌ {exc} — 다른 web 백엔드 실행이 끝난 뒤 다시 시도하세요")
        return 4


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompt-file", help="영문 이미지 프롬프트 파일")
    ap.add_argument("--out", help="저장 경로(.png 권장 — 실제 포맷(png/gif 등)에 맞춰 확장자 자동 조정)")
    ap.add_argument("--max-wait", type=int, default=420)
    ap.add_argument("--browser", help="Chrome|Comet|<실행파일 경로> (미지정 시 저장값/자동 감지)")
    ap.add_argument("--harvest", metavar="URL|MANIFEST", help="중단된 실행 회수")
    ap.add_argument("--check-env", action="store_true")
    ap.add_argument("--probe-login", action="store_true", help="--check-env 와 함께: 실제 로그인 상태까지 확인")
    ap.add_argument("--login", action="store_true", help="로그인용 창을 띄움(foreground)")
    args = ap.parse_args()
    if args.check_env:
        return cmd_check_env(args)
    if args.login:
        return cmd_login(args)
    if args.harvest:
        return _run(cmd_harvest, args)
    if not args.prompt_file or not args.out:
        ap.print_usage()
        return 2
    return _run(cmd_generate, args)


if __name__ == "__main__":
    sys.exit(main())
