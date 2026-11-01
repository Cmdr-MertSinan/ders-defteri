#!/usr/bin/env python3
"""Merge the latest phone/computer notes into data/user-state.json."""

import json
import os
import urllib.request

PATH = "data/user-state.json"


def load_current():
    if not os.path.exists(PATH):
        return {"updatedAt": 0, "dayNotes": {}, "courseNotes": {}}
    with open(PATH, encoding="utf-8") as handle:
        return json.load(handle)


def fetch_latest(topic):
    url = f"https://ntfy.sh/{topic}/json?poll=1&since=2h"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read().decode("utf-8").strip()
    if not text:
        return None
    latest = None
    for line in text.splitlines():
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        body = message.get("message") or ""
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        if "dayNotes" not in payload and "courseNotes" not in payload:
            continue
        latest = payload
    return latest


def merge(base, incoming):
    merged = {
        "updatedAt": max(int(base.get("updatedAt") or 0), int(incoming.get("updatedAt") or 0)),
        "dayNotes": dict(base.get("dayNotes") or {}),
        "courseNotes": dict(base.get("courseNotes") or {}),
    }
    for key in ("dayNotes", "courseNotes"):
        for name, row in (incoming.get(key) or {}).items():
            if not isinstance(row, dict):
                continue
            previous = merged[key].get(name) or {}
            if int(row.get("updatedAt") or 0) >= int(previous.get("updatedAt") or 0):
                merged[key][name] = {
                    "text": str(row.get("text") or ""),
                    "updatedAt": int(row.get("updatedAt") or 0),
                }
    return merged


def main():
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("missing_topic")
        return 1
    incoming = fetch_latest(topic)
    if not incoming:
        print("no_incoming")
        return 0
    current = load_current()
    merged = merge(current, incoming)
    if merged == current:
        print("unchanged")
        return 0
    os.makedirs("data", exist_ok=True)
    with open(PATH, "w", encoding="utf-8") as handle:
        json.dump(merged, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print("updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
