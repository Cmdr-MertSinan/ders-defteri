#!/usr/bin/env python3
"""Join saved Teams classes on this Mac without opening Mert Ajanda."""

import datetime
import json
import os
import pathlib
import re
import subprocess
import time
from urllib.parse import parse_qs, quote, urlparse

ROOT = pathlib.Path("/Users/mert/Projects/ders-defteri")
CONFIG = ROOT / "live-classes.local.json"
STATE_DIR = pathlib.Path.home() / "Library/Logs/mert-ajanda"
STATE = STATE_DIR / "teams-joined.txt"

DAY_MAP = {
    "sun": 0,
    "paz": 0,
    "mon": 1,
    "pzt": 1,
    "tue": 2,
    "sal": 2,
    "wed": 3,
    "car": 3,
    "çar": 3,
    "thu": 4,
    "per": 4,
    "fri": 5,
    "cum": 5,
    "sat": 6,
    "cmt": 6,
}


def meeting_join_url(url):
    raw = (url or "").strip()
    if not raw:
        return ""
    href = re.sub(r"^msteams:", "https:", raw, flags=re.I)
    parsed = urlparse(href)
    match = re.search(r"/l/(?:team|channel)/([^/]+)", parsed.path, re.I)
    if not match:
        return raw
    thread = match.group(1)
    tenant = (parse_qs(parsed.query).get("tenantId") or [""])[0]
    context = quote(json.dumps({"Tid": tenant}, separators=(",", ":"))) if tenant else ""
    join = f"https://teams.microsoft.com/l/meetup-join/{thread}/0"
    if context:
        join += f"?context={context}"
    return join


def app_url(url):
    url = meeting_join_url(url)
    if not url:
        return ""
    if url.startswith("msteams:"):
        return url
    if url.startswith("https://"):
        return "msteams://" + url[len("https://") :]
    if url.startswith("http://"):
        return "msteams://" + url[len("http://") :]
    return url


def parse_hm(value):
    parts = str(value).split(":")
    return int(parts[0]) * 60 + int(parts[1])


def already_joined(key):
    if not STATE.exists():
        return False
    return key in STATE.read_text(encoding="utf-8").splitlines()


def mark_joined(key):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with STATE.open("a", encoding="utf-8") as handle:
        handle.write(key + "\n")


def click_join():
    script = r"""
tell application "Microsoft Teams" to activate
delay 3
tell application "System Events"
  if not (exists process "Microsoft Teams") then return
  tell process "Microsoft Teams"
    set frontmost to true
    delay 0.4
    keystroke return
  end tell
end tell
"""
    subprocess.run(
        ["osascript", "-e", script],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def join(item):
    url = app_url(item.get("joinUrl") or item.get("url") or "")
    if not url:
        return
    subprocess.run(
        ["open", "-a", "Microsoft Teams", url],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    click_join()


def class_days(item):
    days = []
    for raw in item.get("days") or []:
        if isinstance(raw, int):
            days.append(raw)
            continue
        mapped = DAY_MAP.get(str(raw).strip().lower())
        if mapped is not None:
            days.append(mapped)
    return days


def main():
    if not CONFIG.exists():
        return
    try:
        data = json.loads(CONFIG.read_text(encoding="utf-8"))
    except Exception:
        return
    classes = data.get("classes") or []
    now = datetime.datetime.now()
    today = now.strftime("%Y-%m-%d")
    weekday = now.weekday()
    js_day = (weekday + 1) % 7
    for item in classes:
        if not item.get("autoJoin", True):
            continue
        days = class_days(item)
        if days and js_day not in days:
            continue
        hour, minute = str(item.get("start") or "00:00").split(":")[:2]
        start_at = now.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
        offset = (now - start_at).total_seconds()
        if offset < -55 or offset > 45:
            continue
        if offset < 0:
            time.sleep(-offset)
            now = datetime.datetime.now()
            offset = (now - start_at).total_seconds()
        key = f"{today}:{item.get('title')}:{item.get('start')}"
        if already_joined(key):
            continue
        mark_joined(key)
        print(
            f"{now.isoformat(timespec='seconds')} join_click_at offset_s={offset:.3f} {item.get('title')}",
            flush=True,
        )
        join(item)


if __name__ == "__main__":
    main()
