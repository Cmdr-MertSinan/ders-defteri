#!/usr/bin/env python3
"""Join saved Teams classes on this Mac without opening Mert Ajanda."""

import datetime
import json
import os
import pathlib
import subprocess

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


def app_url(url):
    url = (url or "").strip()
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
    minutes = now.hour * 60 + now.minute
    today = now.strftime("%Y-%m-%d")
    weekday = now.weekday()  # Mon=0 ... Sun=6
    # convert to JS-like Sunday=0: (weekday+1)%7? 
    # Python weekday: Mon=0. Our DAY_MAP uses Sun=0.
    js_day = (weekday + 1) % 7
    for item in classes:
        if not item.get("autoJoin", True):
            continue
        days = class_days(item)
        if days and js_day not in days:
            continue
        start = parse_hm(item.get("start") or "00:00")
        if minutes < start - 2 or minutes > start + 20:
            continue
        key = f"{today}:{item.get('title')}:{item.get('start')}"
        if already_joined(key):
            continue
        mark_joined(key)
        join(item)


if __name__ == "__main__":
    main()
