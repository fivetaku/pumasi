#!/usr/bin/env python3
"""chatgpt_web_core — pumasi:image ChatGPT 웹 레인의 브라우저 코어(벤더링).

insane-review(같은 저자, MIT) bin/pack_and_ask.py (커밋 74f0c68, v0.6.15)에서 web 레인이 쓰는
함수·상수와 그 의존만 AST로 추출해 옮겼다. 원본의 repomix·리뷰·프로젝트 기능은 들어 있지 않다.
pumasi 가 insane-review 설치 없이 동작하게 하기 위해서다.

설정 환경변수는 PUMASI_WEB_CORE_* 로 바꿨고, webgen.py 가 import 전에 채운다
(포트·프로필·설정 경로·launch mode). ChatGPT UI 가 바뀌어 insane-review 쪽 셀렉터가 고쳐지면
이 파일도 같은 방식으로 다시 추출해 맞춘다.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path


CDP_PORT = int(os.environ.get("PUMASI_WEB_CORE_CDP_PORT", "9222"))

CDP_URL = f"http://127.0.0.1:{CDP_PORT}"

# 전용(격리) 프로필 — 사용자 주 브라우저 세션과 분리. Chrome 136+는 '기본 프로필'에서
# --remote-debugging-port를 정책적으로 무시하므로(쿠키 탈취 방지), 이 별도 user-data-dir이
# 없으면 디버그 포트가 아예 안 열린다. 모든 OS 공통으로 전용 프로필을 쓴다.
BROWSER_PROFILE_DIR = Path(os.environ.get(
    "PUMASI_WEB_CORE_PROFILE", str(Path.home() / ".insane-review" / "browser-profile")))

# 선택한 브라우저를 영속화(재질문 방지) — 우선순위: --browser > env > config 저장값 > 첫 감지.
CONFIG_PATH = Path(os.environ.get(
    "PUMASI_WEB_CORE_CONFIG", str(Path.home() / ".insane-review" / "config.json")))

CHATGPT_URL = "https://chatgpt.com/"

def _guard_dialogs(ctx, page=None):
    """Stop playwright's default dialog auto-dismiss from racing over CDP.

    Over connect_over_cdp, any JS dialog (beforeunload/alert/confirm) on the
    ChatGPT page triggers playwright's built-in auto-dismiss. Across CDP that
    races the browser → `ProtocolError: No dialog is showing`, an UNCAUGHT
    driver exception that crashes the run (100% CPU spin) before the prompt is
    ever submitted. Registering our own handler disables the default and
    swallows the race.
    """
    def _on_dialog(d):
        try:
            d.dismiss()
        except Exception:
            pass
    def _attach(p):
        try:
            p.on("dialog", _on_dialog)
        except Exception:
            pass
    try:
        for p in (getattr(ctx, "pages", None) or []):
            _attach(p)
        ctx.on("page", _attach)   # cover future tabs/pages too
    except Exception:
        pass
    if page is not None:
        _attach(page)

INPUT_SELECTORS = ["#prompt-textarea", 'div[contenteditable="true"]']

FILE_INPUT_SELECTOR = 'input[type="file"]'

STREAMING_BTN_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[data-testid*="stop"]',
]

# 사용량 한도(쿼터) 차단 배너 감지 문구 — dialog/alert 표면에서만 대조(오탐 방지). 자유롭게 추가.
QUOTA_HINTS = [
    "usage limit", "reached your limit", "limit reached", "you've hit",
    "reached the current usage cap", "try again later", "upgrade to",
    "사용량 한도", "한도에 도달", "사용 한도", "요금제를 업그레이드",
]

def _q(page, selectors):
    """폴백 리스트에서 첫 매치 노드(없으면 None)."""
    for sel in selectors:
        try:
            node = page.query_selector(sel)
        except Exception:
            continue
        if node is not None:
            return node
    return None

def detect_quota_block(page):
    """쿼터/한도 차단 감지(보수적 — role=dialog/alert 표면만 스캔, 본문 응답 텍스트는 안 봄).
    매칭된 문구를 반환, 없으면 None. 실패는 조용히 None(대기 루프를 깨지 않음)."""
    try:
        for sel in ('[role="dialog"]', '[role="alert"]'):
            for node in page.query_selector_all(sel):
                txt = (node.inner_text() or "").strip()
                if not txt:
                    continue
                low = txt.lower()
                for hint in QUOTA_HINTS:
                    if hint.lower() in low:
                        return txt[:200]
    except Exception:
        return None
    return None

LOGIN_WALL_SELECTORS = [
    'button[data-testid="login-button"]',
    'a[href*="auth/login"]',
    'button:has-text("로그인")',
    'button:has-text("Log in")',
]

# --- v0.6.0 identity 결속 ---
# 전송이 만든 '대화 URL'(/c/<id>)에 회수를 결속한다. count 델타는 페이지가 다른 채팅을
# 보여주는 순간 무너진다(2026-07-18 스테일 캡처 실측) — URL 결속이 1차 방어, id-diff가 2차.
CONV_URL_RE = re.compile(r"/c/[0-9a-f]{8}[0-9a-f-]{4,}", re.I)

CONV_URL_CAPTURE_SECS = int(os.environ.get("PUMASI_WEB_CORE_URL_CAPTURE_SECS", "90"))

# ===========================================================================
# 2) 브라우저(CDP) 준비 + fail-closed 검증
# ===========================================================================
def is_port_open(port: int = CDP_PORT) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()

def cdp_browser_ok() -> bool:
    """포트가 '진짜 CDP 브라우저'인지 /json/version으로 검증(엉뚱한 프로세스 차단)."""
    try:
        with urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=4) as r:
            info = json.loads(r.read().decode("utf-8"))
        browser = str(info.get("Browser", ""))
        return any(k in browser for k in ("Chrome", "Chromium", "Comet", "HeadlessChrome", "Edg"))
    except Exception:
        return False

# ---- 크로스플랫폼 브라우저 레지스트리 (mac / windows / linux) ----
def host_os() -> str:
    s = platform.system()
    return "mac" if s == "Darwin" else "win" if s == "Windows" else "linux"

# Arc은 CDP/멀티인스턴스가 불안정해 자동 목록에서 제외(사용자가 절대경로로 직접 지정은 가능).
def _browser_registry() -> list[tuple[str, list[str]]]:
    """[(표시이름, [후보 실행경로...])] — OS별. 절대경로는 존재검사, 비절대는 PATH(which)로 해석."""
    osname = host_os()
    home = Path.home()
    if osname == "mac":
        A = "/Applications"
        return [
            ("Chrome",   [f"{A}/Google Chrome.app/Contents/MacOS/Google Chrome"]),
            ("Comet",    [f"{A}/Comet.app/Contents/MacOS/Comet"]),
            ("Brave",    [f"{A}/Brave Browser.app/Contents/MacOS/Brave Browser"]),
            ("Edge",     [f"{A}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]),
            ("Chromium", [f"{A}/Chromium.app/Contents/MacOS/Chromium"]),
            ("Vivaldi",  [f"{A}/Vivaldi.app/Contents/MacOS/Vivaldi"]),
        ]
    if osname == "win":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pfx = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        lad = os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local"))
        return [
            ("Chrome",   [rf"{pf}\Google\Chrome\Application\chrome.exe",
                          rf"{pfx}\Google\Chrome\Application\chrome.exe",
                          rf"{lad}\Google\Chrome\Application\chrome.exe"]),
            ("Edge",     [rf"{pf}\Microsoft\Edge\Application\msedge.exe",
                          rf"{pfx}\Microsoft\Edge\Application\msedge.exe"]),
            ("Brave",    [rf"{pf}\BraveSoftware\Brave-Browser\Application\brave.exe",
                          rf"{pfx}\BraveSoftware\Brave-Browser\Application\brave.exe",
                          rf"{lad}\BraveSoftware\Brave-Browser\Application\brave.exe"]),
            ("Chromium", [rf"{lad}\Chromium\Application\chrome.exe"]),
            ("Vivaldi",  [rf"{lad}\Vivaldi\Application\vivaldi.exe"]),
        ]
    return [  # linux
        ("Chrome",   ["google-chrome", "google-chrome-stable"]),
        ("Chromium", ["chromium", "chromium-browser"]),
        ("Brave",    ["brave-browser", "brave"]),
        ("Edge",     ["microsoft-edge", "microsoft-edge-stable"]),
        ("Vivaldi",  ["vivaldi", "vivaldi-stable"]),
    ]

def detect_browsers() -> list[tuple[str, str]]:
    """이 OS에 설치된 크로미움 계열 브라우저 [(이름, 실행경로)]. env 경로 오버라이드도 우선 반영."""
    found, seen = [], set()
    for env, nm in (("PUMASI_WEB_CORE_BROWSER_PATH", None),
                    ("PUMASI_WEB_CORE_CHROME", "Chrome"), ("PUMASI_WEB_CORE_COMET", "Comet")):
        p = os.environ.get(env)
        if p and Path(p).exists():
            name = nm or Path(p).stem
            if name.lower() not in seen:
                found.append((name, p)); seen.add(name.lower())
    for name, cands in _browser_registry():
        if name.lower() in seen:
            continue
        for c in cands:
            p = c if os.path.isabs(c) else (shutil.which(c) or "")
            if p and Path(p).exists():
                found.append((name, p)); seen.add(name.lower())
                break
    return found

def _load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _save_config_key(key: str, value) -> None:
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        cfg = _load_config()
        cfg[key] = value
        tmp = CONFIG_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, CONFIG_PATH)
    except Exception:
        pass

LAUNCH_MODES = ("foreground", "background", "headless")

def hide_browser_if_background() -> None:
    """background 모드에서 브라우저 앱을 다시 숨긴다.

    `open -g`로 조용히 띄워도 playwright가 `ctx.new_page()`로 새 탭을 만드는 순간
    macOS가 그 앱을 앞으로 끌어올린다. 탭 생성 직후 이걸 호출해 다시 내린다
    (앱만 숨길 뿐 프로세스·CDP 세션은 그대로라 자동화는 계속 동작한다)."""
    if host_os() != "mac" or get_launch_mode() != "background":
        return
    proc = (_load_config().get("launch_proc_name") or "").strip()
    if not proc:
        return
    try:
        subprocess.run(
            ["osascript", "-e",
             f'tell application "System Events" to set visible of process "{proc}" to false'],
            capture_output=True, timeout=5)
    except Exception:
        pass

def get_launch_mode() -> str:
    env = (os.environ.get("PUMASI_WEB_CORE_LAUNCH_MODE") or "").strip().lower()
    if env in LAUNCH_MODES:
        return env
    mode = (_load_config().get("launch_mode") or "").strip().lower()
    # 미설정 기본값은 background — 창이 안 보이면서도 ChatGPT가 정상 브라우저로 인식한다.
    # (headless는 컴포저를 못 받아 전송 실패, foreground는 포커스를 뺏어 작업 흐름을 끊는다. 2026-08-26 실측)
    return mode if mode in LAUNCH_MODES else "background"

def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "browser"

def profile_dir_for(name: str) -> Path:
    """브라우저별 전용 프로필 분리. 크로미움 계열은 브라우저(앱)마다 쿠키 암호화 키가 달라
    (mac Keychain 'X Safe Storage' 항목이 앱별), 같은 user-data-dir을 다른 브라우저로 열면
    기존 세션 쿠키가 복호화 불가 → 로그인이 통째로 깨진다. 기존 프로필(BROWSER_PROFILE_DIR)은
    최초 사용 브라우저(owner)가 계속 소유해 기존 로그인을 보존하고, 다른 브라우저는
    'browser-profile-<이름>' 접미사 디렉토리를 쓴다."""
    cfg = _load_config()
    owner = cfg.get("profile_owner")
    if not owner:
        # 소유자 미기록: 레거시 프로필이 있으면 저장된 browser(없으면 이번 브라우저)가 승계
        owner = (cfg.get("browser") if BROWSER_PROFILE_DIR.exists() else None) or name
        _save_config_key("profile_owner", owner)
    # owner가 절대경로로 저장됐을 수 있음(--browser <경로>) → stem으로 비교
    owner_name = Path(owner).stem if os.path.isabs(str(owner)) else str(owner)
    if _slug(owner_name) == _slug(name):
        return BROWSER_PROFILE_DIR
    return BROWSER_PROFILE_DIR.with_name(f"{BROWSER_PROFILE_DIR.name}-{_slug(name)}")

def resolve_browser(name_or_path: str | None) -> tuple[str, str] | None:
    """--browser 값(이름 'chrome' 또는 절대경로)을 (이름, 경로)로 해석.
    인자 없으면 config 저장값 → 첫 감지 브라우저 순. 못 찾으면 None."""
    if name_or_path:
        if os.path.isabs(name_or_path) and Path(name_or_path).exists():
            return (Path(name_or_path).stem, name_or_path)
        for name, path in detect_browsers():
            if name.lower() == name_or_path.lower():
                return (name, path)
        return None
    saved = _load_config().get("browser")
    if saved:
        r = resolve_browser(saved)
        if r:
            return r
    bs = detect_browsers()
    return bs[0] if bs else None

def _kill_profile_browsers(profile_dir: Path) -> None:
    """전용 프로필을 점유 중인 브라우저 프로세스를 정리(크로스플랫폼 best-effort).
    전용 프로필이라 종료해도 로그인 쿠키는 디스크에 보존된다 — 스테일 인스턴스가
    새 런치를 흡수해(같은 user-data-dir 싱글톤) 디버그 포트가 안 열리는 교착을 푼다."""
    target = str(profile_dir)
    try:
        if host_os() == "win":
            ps = ("Get-CimInstance Win32_Process | "
                  f"Where-Object {{ $_.CommandLine -like '*{target}*' }} | "
                  "ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                  "-ErrorAction SilentlyContinue }")
            subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                           capture_output=True, timeout=15)
        else:
            subprocess.run(["pkill", "-f", target], capture_output=True, timeout=10)
    except Exception:
        pass

def launch_browser_exe(path: str, name: str | None = None) -> bool:
    """전용 프로필 + 디버그 포트로 크로미움 직접 실행(크로스플랫폼) 후 CDP가 뜰 때까지 대기.
    전용 프로필에 스테일 인스턴스가 떠 있어 새 런치가 포트를 못 여는 경우(같은 user-data-dir
    싱글톤 교착)를 감지해 그 프로세스를 정리하고 1회 재시도한다.
    프로필은 브라우저별로 분리(profile_dir_for) — 다른 브라우저가 같은 프로필을 열어
    쿠키 암호화 키 불일치로 로그인이 깨지는 것을 막는다."""
    profile_dir = profile_dir_for(name or Path(path).stem)
    try:
        profile_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    mode = get_launch_mode()
    # macOS에서 앱을 다시 숨기려면 System Events용 프로세스명이 필요하다(실행파일 basename).
    _save_config_key("launch_proc_name", Path(path).name)
    cmd = [path, f"--remote-debugging-port={CDP_PORT}",
           f"--user-data-dir={profile_dir}",
           "--no-first-run", "--no-default-browser-check"]
    if mode == "headless":
        # 신형 헤드리스만 CDP·쿠키가 정상 동작한다(구형 --headless는 로그인 세션이 깨짐)
        cmd.append("--headless=new")

    def _spawn_and_wait(secs: int) -> bool:
        try:
            if mode == "background" and host_os() == "mac":
                # `open -g`: 창은 뜨되 포커스를 가져가지 않아 사용자의 작업 흐름을 끊지 않는다.
                # -n(새 인스턴스)로 전용 프로필이 기존 창에 흡수되는 것을 막는다.
                subprocess.Popen(["open", "-g", "-n", "-a", path, "--args", *cmd[1:]],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as exc:
            print(f"  ❌ 실행 실패: {str(exc)[:80]}")
            return False
        for i in range(secs):
            if is_port_open() and cdp_browser_ok():
                print(f"  ✓ 시작 완료 ({i + 1}s)")
                time.sleep(2)
                return True
            time.sleep(1)
        return False

    print(f"  브라우저 시작: {Path(path).name} (CDP {CDP_PORT}, 전용 프로필 {profile_dir.name})")
    if _spawn_and_wait(15):
        return True
    # 포트 미개방 = 전용 프로필에 떠 있던 스테일 인스턴스가 런치를 흡수했을 가능성.
    # 그 프로세스를 정리(로그인 보존)하고 싱글톤 락이 풀리길 기다린 뒤 1회 재시도.
    print("  ⚠️  디버그 포트 미개방 — 전용 프로필 스테일 인스턴스 정리 후 재시도")
    _kill_profile_browsers(profile_dir)
    time.sleep(3)
    if _spawn_and_wait(20):
        return True
    print("  ❌ 브라우저 시작 타임아웃 (전용 프로필 정리 후에도 실패)")
    return False

def ensure_browser(browser_arg: str | None) -> bool:
    """이미 CDP가 떠 있으면 그걸 검증·사용, 아니면 지정/감지된 브라우저를 전용 프로필로 띄운다."""
    if is_port_open():
        if cdp_browser_ok():
            print(f"  ✓ CDP 브라우저 확인 (port {CDP_PORT})")
            return True
        print(f"  ❌ port {CDP_PORT}에 CDP 브라우저가 아닌 다른 프로세스가 떠 있음")
        return False
    resolved = resolve_browser(browser_arg)
    if not resolved:
        avail = ", ".join(n for n, _ in detect_browsers()) or "없음"
        print(f"  ❌ 사용할 브라우저를 찾지 못함 (지정='{browser_arg}', 설치감지=[{avail}])")
        return False
    return launch_browser_exe(resolved[1], resolved[0])

# 실행 중 브라우저가 디스크에서 자동 업데이트되면(스테일 인스턴스) CDP 연결이 이 에러로 깨진다.
# 실측(2026-07-09, Chrome 150.46 실행 중 + 디스크 150.101): connect_over_cdp가 아래 메시지로 실패.
_STALE_CDP_MARKERS = ("Browser context management is not supported",)

def _restart_profile_browser() -> bool:
    """전용 프로필 브라우저를 재기동(쿠키는 디스크 보존 → 로그인 유지)."""
    saved = _load_config().get("browser")
    r = resolve_browser(saved) if saved else resolve_browser(None)
    if not r:
        return False
    _kill_profile_browsers(profile_dir_for(r[0]))
    time.sleep(3)
    return launch_browser_exe(r[1], r[0])

def connect_cdp(pw):
    """connect_over_cdp + 스테일 브라우저 자동 복구.
    브라우저가 떠 있는 동안 자동 업데이트되면 CDP가 깨진다(위 마커). 이때 전용 프로필
    프로세스만 재기동(로그인 보존)하고 1회 재연결 — 사용자에게 '로그인 풀림'으로 보이던
    상황의 상당수가 이 스테일 케이스다."""
    try:
        return pw.chromium.connect_over_cdp(CDP_URL)
    except Exception as exc:
        if not any(m in str(exc) for m in _STALE_CDP_MARKERS):
            raise
        print("  ♻️  CDP 연결 실패(스테일 브라우저 — 실행 중 자동업데이트 추정) → 전용 브라우저 재기동(로그인 보존)")
        if not _restart_profile_browser():
            raise
        return pw.chromium.connect_over_cdp(CDP_URL)

# ===========================================================================
# 3) ChatGPT 상호작용 프리미티브
# ===========================================================================
def find_input(page):
    for sel in INPUT_SELECTORS:
        try:
            el = page.query_selector(sel)
            if el:
                return el
        except Exception:
            continue
    return None

def is_streaming(page) -> bool:
    try:
        return _q(page, STREAMING_BTN_SELECTORS) is not None
    except Exception:
        return False

def msg_id_set(page) -> set:
    """현재 DOM의 메시지 UUID 집합(구 data-message-id + 새 selection/search UUID).
    실패 시 빈 집합 — base로 쓰일 때 빈 집합은 '아무것도 제외 안 함'이라 fail-open이 아니다
    (URL 결속이 1차 방어이므로 id는 우리 채팅 안에서만 판정에 쓰인다)."""
    try:
        return set(page.eval_on_selector_all(
            '[data-message-id], [data-chatgpt-selection-message-id], [data-chatgpt-search-message-ids]',
            '''els => els.flatMap(e => ['data-message-id', 'data-chatgpt-selection-message-id',
              'data-chatgpt-search-message-ids'].flatMap(a => (e.getAttribute(a) || '').split(/\\s+/).filter(Boolean)))'''))
    except Exception:
        return set()

def current_url(page) -> str:
    """페이지의 '실제' 현재 URL. page.url은 로컬 캐시라 CDP 왕복 없이는 SPA pushState를
    반영하지 못한다(실측 2026-07-23: 전송 후 30s 폴링에도 스테일, evaluate 1회로 즉시 갱신).
    location.href 평가가 1순위, 실패 시 page.url 폴백."""
    try:
        return page.evaluate("() => location.href") or ""
    except Exception:
        try:
            return page.url or ""
        except Exception:
            return ""

def capture_conv_url(page, timeout_secs: int = CONV_URL_CAPTURE_SECS) -> str | None:
    """전송 후 SPA가 발급하는 대화 URL(/c/<id>)을 포착. 실패 시 None(호출자 fail-closed)."""
    deadline = time.monotonic() + timeout_secs
    while time.monotonic() < deadline:
        u = current_url(page)
        if CONV_URL_RE.search(u):
            return u
        time.sleep(1)
    return None

def normalize(text: str | None) -> str:
    return re.sub(r"\s+", " ", text).strip() if text else ""

# ---- Chat / Work 모드 (실측 2026-08-29) ----
# 헤더 중앙 radiogroup에 'Chat'/'Work' 라디오 2개. URL·_account 쿠키가 동일해
# workspace_id 결속으로는 구분되지 않는다. Work 모드엔 Pro 추론단계가 아예 없고
# (슬라이더에 Pro 눈금 부재, data-max="false") pill이 '5.6 Sol 매우 높음'으로 뜬다.
# 선택은 sticky — 사람이 웹에서 Work로 바꿔 쓰면 이후 자동 실행이 조용히 비-Pro로 나간다.
MODE_RADIO_SELECTOR = ('[role="radiogroup"] [role="radio"], '
                       '[role="group"][aria-label="작성기 모드"] button[aria-pressed], '
                       '[role="group"][aria-label="Composer mode" i] button[aria-pressed]')

JS_READ_MODE = """() => {
  const rs = [...document.querySelectorAll('""" + MODE_RADIO_SELECTOR + """')]
    .filter(x => !x.closest('[inert], [aria-hidden="true"]') && x.getClientRects().length)
    .map(x => ({label: (x.textContent || '').trim(),
      checked: x.getAttribute('aria-checked') === 'true' || x.getAttribute('aria-pressed') === 'true'}));
  if (!rs.some(r => /^(chat|work)$/i.test(r.label))) return null;
  const on = rs.find(r => r.checked);
  return on ? on.label : '';
}"""

JS_CLICK_MODE = """(want) => {
  const el = [...document.querySelectorAll('""" + MODE_RADIO_SELECTOR + """')]
    .find(x => !x.closest('[inert], [aria-hidden="true"]') && x.getClientRects().length
      && (x.textContent || '').trim().toLowerCase() === want.toLowerCase());
  if (!el) return false;
  el.click();
  return true;
}"""

def read_mode(page) -> str | None:
    """현재 Chat/Work 모드. 토글이 없는 계정/UI면 None."""
    try:
        return page.evaluate(JS_READ_MODE)
    except Exception:
        return None

def ensure_chat_mode(page) -> tuple[bool, str | None]:
    """Pro가 존재하는 Chat 모드로 보정한다.
    반환: (chat 모드 확정 여부, 관측된 모드). 토글 자체가 없으면 (True, None) —
    구 UI/개인 계정은 애초에 모드 분기가 없으므로 통과시킨다."""
    mode = read_mode(page)
    if mode is None:
        return True, None
    if mode.lower() == "chat":
        return True, mode
    print(f"  ⚠️  현재 모드가 '{mode or '미상'}' — Work 모드엔 Pro가 없다. Chat으로 전환 시도")
    try:
        if not page.evaluate(JS_CLICK_MODE, "Chat"):
            print("  ❌ Chat 라디오를 찾지 못함")
            return False, mode
    except Exception as e:
        print(f"  ❌ 모드 전환 실패: {e}")
        return False, mode
    for _ in range(10):
        time.sleep(0.5)
        now = read_mode(page)
        if now and now.lower() == "chat":
            print("  ✓ Chat 모드로 전환됨")
            return True, now
    print("  ❌ Chat 모드 전환이 반영되지 않음")
    return False, read_mode(page)

SEND_BTN_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="보내기" i]',
    'button[aria-label*="프롬프트 보내기" i]',
]

def put_text(page, message: str):
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(0.3)
    page.evaluate(
        """() => { const el = document.querySelector('#prompt-textarea')
            || document.querySelector('div[contenteditable=\\"true\\"]');
            if (el) { el.scrollIntoView({block:'center'}); el.focus(); } }"""
    )
    time.sleep(0.3)
    # 크로스플랫폼: OS 클립보드/⌘V(맥 전용) 대신 Playwright 네이티브 insert_text(insertText 이벤트).
    # → mac/win/linux 동일 동작 + 동시 실행 시 클립보드 경합 제거. 실패 시 키 입력 폴백.
    try:
        page.keyboard.insert_text(message)
    except Exception:
        page.keyboard.type(message)
    time.sleep(0.6)

def read_composer_text(page) -> str:
    """입력창(composer)에 현재 들어있는 텍스트를 읽는다(전송 전 프롬프트 입력 검증용)."""
    try:
        return page.evaluate(
            """() => { const el = document.querySelector('#prompt-textarea')
                || document.querySelector('div[contenteditable=\\"true\\"]');
                return el ? (el.innerText || el.textContent || '') : ''; }"""
        ) or ""
    except Exception:
        return ""

def composer_has_prompt(page, prompt: str) -> bool:
    """프롬프트 '전체'가 composer에 들어갔는지 검증(앞 24자 가드가 아니라 동일성).
    잘림(want⊄got)·중복/오염(got가 과도하게 김) 모두 fail-closed로 거부 → '첨부만/잘린 질문' 전송 차단."""
    want = normalize(prompt)
    if not want:
        return True
    got = normalize(read_composer_text(page))
    if want not in got:                  # 일부만 입력(잘림) → 거부
        return False
    if got.count(want) > 1:              # 프롬프트가 통째로 2번 이상(중복 입력) → 거부(길이 무관)
        return False
    if len(got) > len(want) * 1.5 + 20:  # 그 외 오염 payload → 거부
        return False
    return True

def clear_composer(page):
    """재입력 전 composer를 비운다(중복 입력 방지)."""
    try:
        page.evaluate(
            """() => { const el = document.querySelector('#prompt-textarea')
                || document.querySelector('div[contenteditable=\\"true\\"]');
                if (el) { el.focus(); } }"""
        )
        page.keyboard.press("Meta+a")
        page.keyboard.press("Backspace")
        time.sleep(0.2)
    except Exception:
        pass

def click_send(page) -> bool:
    """전송 버튼이 visible·enabled 될 때까지 폴링 후 클릭(첨부 처리 시간 대비). 끝까지 안 되면 Enter."""
    for _ in range(15):  # 최대 ~15s 대기
        for sel in SEND_BTN_SELECTORS:
            try:
                btn = page.query_selector(sel)
                if btn and btn.is_visible() and btn.is_enabled():
                    btn.click()
                    print("  ✓ 전송 버튼 클릭")
                    time.sleep(1)
                    return True
            except Exception:
                continue
        time.sleep(1)
    print("  ⚠️  전송 버튼이 enabled 안 됨 → Enter 폴백")
    page.keyboard.press("Enter")
    time.sleep(1)
    return False

def login_state(page, wait_secs: int = 12) -> str:
    """로그인 3단계 판정: 'ok' | 'no' | 'unknown'.
    - 'no': 로그인 벽(로그인 버튼 등)이 실제로 보일 때만 — 이것만이 재로그인 요구의 근거.
    - 'ok': 입력창 + 인증 세션에서만 렌더되는 컴포저 어포던스(모델 pill/파일 input) 확인.
    - 'unknown': wait_secs 동안 둘 다 안 보임(SPA 로딩 지연/CF 챌린지/UI 변경).
      기존엔 이 경우를 'no'로 오판해 멀쩡한 세션에 재로그인을 반복 요구했다(거짓 음성).
    판정 전체를 폴링 — 느린 환경일수록 컴포저가 늦게 떠서 단발 조회는 오판한다."""
    deadline = time.monotonic() + wait_secs
    while True:
        for sel in LOGIN_WALL_SELECTORS:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    return "no"
            except Exception:
                continue
        try:
            if find_input(page) is not None and (
                    page.query_selector('button.__composer-pill')
                    or page.query_selector(FILE_INPUT_SELECTOR)):
                return "ok"
        except Exception:
            pass
        if time.monotonic() >= deadline:
            return "unknown"
        time.sleep(0.5)
