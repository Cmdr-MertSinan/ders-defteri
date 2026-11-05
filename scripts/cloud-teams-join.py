#!/usr/bin/env python3
"""Join a Teams class at the scheduled start, then leave below 10 participants."""

import datetime
import json
import os
import re
import sys
import time
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Istanbul")
THRESHOLD = 10


def log(message):
    now = datetime.datetime.now(TZ).isoformat(timespec="seconds")
    print(f"{now} {message}", flush=True)


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


def click_first(page, names, timeout=8000):
    for name in names:
        loc = page.get_by_role("button", name=name)
        try:
            loc.first.wait_for(state="visible", timeout=timeout)
            loc.first.click()
            return True
        except Exception:
            continue
    return False


def visible_button(page, names, timeout=1500):
    for name in names:
        loc = page.get_by_role("button", name=name)
        try:
            loc.first.wait_for(state="visible", timeout=timeout)
            return True
        except Exception:
            continue
    return False


def fill_first(page, selectors, value):
    for selector in selectors:
        loc = page.locator(selector)
        try:
            loc.first.wait_for(state="visible", timeout=8000)
            loc.first.fill(value)
            return True
        except Exception:
            continue
    return False


def parse_hm(value):
    parts = str(value or "18:00").split(":")
    return int(parts[0]), int(parts[1] if len(parts) > 1 else 0)


def class_plan(now):
    start_h, start_m = parse_hm(os.environ.get("TEAMS_CLASS_START", "18:00"))
    end_by_day = {
        0: os.environ.get("TEAMS_CLASS_END_HALK", "20:00"),
        3: os.environ.get("TEAMS_CLASS_END_FIZYO", "21:00"),
        4: os.environ.get("TEAMS_CLASS_END_ANATOMI", "21:00"),
    }
    end_h, end_m = parse_hm(end_by_day.get(now.weekday(), "21:00"))
    start = now.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
    end = now.replace(hour=end_h, minute=end_m, second=0, microsecond=0)
    return start, end


def join_url_for_today(now):
    by_day = {
        0: os.environ.get("TEAMS_JOIN_HALK", "").strip(),
        3: os.environ.get("TEAMS_JOIN_FIZYO", "").strip(),
        4: os.environ.get("TEAMS_JOIN_ANATOMI", "").strip(),
    }
    return meeting_join_url(by_day.get(now.weekday(), "") or os.environ.get("TEAMS_JOIN_URL", "").strip())


def wait_until(target):
    while True:
        now = datetime.datetime.now(TZ)
        remaining = (target - now).total_seconds()
        if remaining <= 0:
            return now
        time.sleep(0.05 if remaining < 2 else min(1.0, remaining))


def login(page, user, password):
    fill_first(
        page,
        [
            'input[type="email"]',
            'input[name="loginfmt"]',
            'input[placeholder*="E-posta"]',
            'input[placeholder*="email" i]',
        ],
        user,
    )
    click_first(page, ["İleri", "Next"])
    time.sleep(2)
    fill_first(
        page,
        [
            'input[type="password"]',
            'input[name="passwd"]',
            'input[placeholder*="Parola"]',
            'input[placeholder*="Password"]',
        ],
        password,
    )
    click_first(page, ["Oturum açın", "Sign in"])
    time.sleep(3)
    click_first(page, ["Evet", "Yes"], timeout=5000)
    time.sleep(2)


LEAVE_NAMES = ["Ayrıl", "Leave", "Hang up", "Çağrıyı sonlandır", "Leave call", "Leave meeting"]
JOIN_NAMES = ["Katıl", "Şimdi katıl", "Join now", "Join", "Katılın"]


def in_meeting(page):
    return visible_button(page, LEAVE_NAMES, timeout=1200)


def confirm_joined(page, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if in_meeting(page):
            return True
        time.sleep(1.5)
    return False


def participant_count(page):
    try:
        click_first(
            page,
            ["Katılımcılar", "Kişiler", "People", "Show participants", "Roster"],
            timeout=1500,
        )
        time.sleep(1)
        chunks = [page.inner_text("body")]
        labels = page.eval_on_selector_all(
            "[aria-label]",
            "els => els.map(el => el.getAttribute('aria-label') || '')",
        )
        chunks.append("\n".join(labels or []))
        text = "\n".join(chunks)
        found = [
            int(num)
            for num in re.findall(
                r"(\d+)\s*(?:katılımcı|kişiler|participants?|people)\b",
                text,
                flags=re.I,
            )
        ]
        if not found:
            return None
        return max(found)
    except Exception as error:
        log(f"participant_read_failed {error}")
        return None


def leave_meeting(page):
    return click_first(page, LEAVE_NAMES, timeout=8000)


def watch_and_leave(page, max_seconds):
    seen_full = False
    left = False
    last_count = None
    deadline = time.time() + max_seconds
    log("watch_start leave_below=9 stay_at_or_above=10")
    while time.time() < deadline:
        if not in_meeting(page):
            log("meeting_ui_missing skip_leave")
            time.sleep(15)
            continue
        count = participant_count(page)
        if count is None:
            log("participants=unreadable skip_leave")
            time.sleep(15)
            continue
        last_count = count
        log(f"participants={count}")
        if count >= THRESHOLD:
            seen_full = True
        elif seen_full and count <= THRESHOLD - 1 and not left:
            log(f"leave_at={datetime.datetime.now(TZ).isoformat(timespec='seconds')} participants={count}")
            leave_meeting(page)
            left = True
            log("left_once")
            return last_count
        time.sleep(15)
    if not left and in_meeting(page):
        log(
            f"leave_at={datetime.datetime.now(TZ).isoformat(timespec='seconds')} "
            f"participants={last_count if last_count is not None else 'unknown'} reason=max_time"
        )
        leave_meeting(page)
    return last_count


def main():
    user = os.environ.get("TEAMS_USER", "").strip()
    password = os.environ.get("TEAMS_PASSWORD", "").strip()
    wait_for_start = os.environ.get("TEAMS_WAIT_FOR_START", "1") == "1"
    max_seconds = int(os.environ.get("TEAMS_MAX_SECONDS", "14400"))
    now = datetime.datetime.now(TZ)
    start, end = class_plan(now)
    url = join_url_for_today(now)
    log(f"weekday={now.weekday()} class_start={start.isoformat()} class_end={end.isoformat()} url_ok={bool(url)}")
    if not user or not password or not url:
        log("missing secrets")
        sys.exit(1)

    if now > end:
        log("too_late class_already_ended")
        return

    from playwright.sync_api import sync_playwright

    login_at = start - datetime.timedelta(minutes=6)
    if wait_for_start:
        remaining_to_login = (login_at - datetime.datetime.now(TZ)).total_seconds()
        if remaining_to_login > 0:
            log(f"waiting_for_login remaining_s={remaining_to_login:.3f}")
            wait_until(login_at)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        time.sleep(2)
        login(page, user, password)
        log("login_attempted")

        if wait_for_start:
            remaining = (start - datetime.datetime.now(TZ)).total_seconds()
            if remaining > 0:
                log(f"waiting_for_start remaining_s={remaining:.3f}")
                wait_until(start)
            else:
                log(f"late_start offset_s={-remaining:.3f}")

        click_at = datetime.datetime.now(TZ)
        offset = (click_at - start).total_seconds()
        log(f"join_click_at={click_at.isoformat(timespec='milliseconds')} offset_s={offset:.3f}")
        click_first(page, JOIN_NAMES, timeout=15000)
        joined = confirm_joined(page)
        log(f"joined={joined}")
        if not joined:
            log("join_not_confirmed skip_leave_watch")
            context.close()
            browser.close()
            sys.exit(1)

        watch_and_leave(page, max_seconds=max_seconds)
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
