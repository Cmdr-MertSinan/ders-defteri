#!/usr/bin/env python3
"""Join a Teams class from GitHub's cloud runners using repo secrets."""

import os
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


def main():
    user = os.environ.get("TEAMS_USER", "").strip()
    password = os.environ.get("TEAMS_PASSWORD", "").strip()
    url = os.environ.get("TEAMS_JOIN_URL", "").strip()
    stay_seconds = int(os.environ.get("TEAMS_STAY_SECONDS", "900"))
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
        time.sleep(max(30, stay_seconds))
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
