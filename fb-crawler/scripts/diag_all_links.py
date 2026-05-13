#!/usr/bin/env python3
"""Listet ALLE FB-internen Links im DOM, gruppiert nach URL-Pattern.
Damit sehen wir wo FB die Post-Permalinks aktuell ablegt.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.cdp_attach import attached_browser, list_group_pages  # noqa: E402

DIAG_JS = r"""
() => {
  const all = Array.from(document.querySelectorAll('a[href*="facebook.com/groups/"], a[href^="/groups/"]'));
  const buckets = {
    posts_no_comment: [],
    posts_with_comment: [],
    permalink: [],
    multi_permalinks: [],
    photo: [],
    user: [],
    other: []
  };
  for (const a of all) {
    const h = a.href;
    if (/[?&]comment_id=/.test(h)) {
      buckets.posts_with_comment.push(h.slice(0, 120));
    } else if (/\/posts\/[0-9]+/.test(h)) {
      buckets.posts_no_comment.push(h.slice(0, 120));
    } else if (/\/permalink\//.test(h)) {
      buckets.permalink.push(h.slice(0, 120));
    } else if (/multi_permalinks/.test(h)) {
      buckets.multi_permalinks.push(h.slice(0, 120));
    } else if (/\/photo/.test(h)) {
      buckets.photo.push(h.slice(0, 120));
    } else if (/\/user\//.test(h)) {
      buckets.user.push(h.slice(0, 120));
    } else {
      buckets.other.push(h.slice(0, 120));
    }
  }
  // dedup per bucket
  const out = {};
  for (const [k, v] of Object.entries(buckets)) {
    out[k] = Array.from(new Set(v));
  }
  // Body-Snippet: erste 800 Zeichen sichtbarer Text
  out._bodyChars = document.body.innerText.length;
  out._bodySample = document.body.innerText.slice(0, 800);
  return out;
}
"""


def main() -> int:
    with attached_browser(9222) as (_, port):
        tabs = list_group_pages(port)
        if not tabs:
            print("(keine FB-Group-Tabs offen)")
            return 1
        for page, group in tabs:
            print(f"=== {page.url[:80]} ===")
            data = page.evaluate(DIAG_JS)
            for k, v in data.items():
                if k.startswith("_"):
                    print(f"{k}: {v}")
                else:
                    print(f"\n--- {k} ({len(v)}) ---")
                    for u in v[:5]:
                        print(f"  {u}")
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
