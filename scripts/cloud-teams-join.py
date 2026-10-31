#!/usr/bin/env python3
"""Join a Teams class and leave after attendance drops below 10."""

import os
import re
import sys
import time


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


def participant_count(page):
    click_first(
        page,
        ["Katılımcılar", "Kişiler", "People", "Show participants", "Roster"],
        timeout=1500,
    )
    time.sleep(1)
    chunks = []
    try:
        chunks.append(page.inner_text("body"))
    except Exception:
        pass
    try:
        labels = page.eval_on_selector_all(
            "[aria-label]",
            "els => els.map(el => el.getAttribute('aria-label') || '')",
        )
        chunks.append("\n".join(labels or []))
    except Exception:
        pass
    text = "\n".join(chunks)
    found = [
        int(num)
        for num in re.findall(
            r"(\d+)\s*(?:katılımcı|kişiler|participants?|people)\b",
            text,
            flags=re.I,
        )
    ]
    return max(found) if found else None


def leave_meeting(page):
    click_first(
        page,
        ["Ayrıl", "Leave", "Hang up", "Çağrıyı sonlandır", "Leave call", "Leave meeting"],
        timeout=8000,
    )


def wait_until_class_thins(page, threshold=10, max_seconds=14400):
    seen_full = False
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        count = participant_count(page)
        if count is not None:
            print(f"participants={count}")
            if count >= threshold:
                seen_full = True
            elif seen_full and count < threshold:
                print("class_thinned")
                leave_meeting(page)
                return
        time.sleep(20)
    print("max_time")
    leave_meeting(page)


def main():
    user = os.environ.get("TEAMS_USER", "").strip()
    password = os.environ.get("TEAMS_PASSWORD", "").strip()
    url = os.environ.get("TEAMS_JOIN_URL", "").strip()
    threshold = int(os.environ.get("TEAMS_LEAVE_BELOW", "10"))
    max_seconds = int(os.environ.get("TEAMS_MAX_SECONDS", "14400"))
    if not user or not password or not url:
        print("missing secrets", file=sys.stderr)
        sys.exit(1)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        time.sleep(3)

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
        time.sleep(5)
        click_first(
            page,
            ["Katıl", "Şimdi katıl", "Join now", "Join", "Katılın"],
            timeout=15000,
        )
        print("joined_or_attempted")
        wait_until_class_thins(page, threshold=threshold, max_seconds=max_seconds)
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
