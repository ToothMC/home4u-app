#!/usr/bin/env python3
"""DOM-Diagnose für FB-Group-Tabs im CDP-attached Chrome.

Dumpt pro [role="article"] im offenen Tab strukturiert:
  - article-Index
  - hasArticleAncestor (true = vermutlich Kommentar)
  - permalink (gekürzt) + comment_id-Flag
  - post_id (falls extractbar)
  - Text-Längen pro Strategie:
      * longestDirAuto: längster div[dir="auto"]-Block
      * fullClean: kompletter article-innerText ohne h3/buttons
  - Text-Snippet (erste 200 Zeichen) der jeweils längeren Strategie

Usage (auf dem Mac mini):
    cd ~/Projekte/home4u-app/fb-crawler
    .venv/bin/python scripts/diag_dom.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.cdp_attach import attached_browser, list_group_pages  # noqa: E402

DIAG_JS = r"""
() => {
  const arts = Array.from(document.querySelectorAll('[role="article"]'));
  return arts.map((a, i) => {
    const ancestor = a.parentElement && a.parentElement.closest('[role="article"]');
    const perma = a.querySelector('a[href*="/posts/"], a[href*="/permalink/"]');
    const permaHref = perma ? perma.href : null;
    const idMatch = permaHref ? permaHref.match(/\/(?:posts|permalink)\/([0-9]+)/) : null;
    const post_id = idMatch ? idMatch[1] : null;
    const commentFlag = permaHref ? /[?&]comment_id=/.test(permaHref) : false;

    // Strategie A: längster div[dir="auto"]
    const dirAutos = Array.from(a.querySelectorAll('div[dir="auto"]'));
    let longestDirAuto = "";
    for (const c of dirAutos) {
      const t = (c.innerText || "").trim();
      if (t.length > longestDirAuto.length) longestDirAuto = t;
    }

    // Strategie B: gesamter article-innerText minus h3/buttons
    const clone = a.cloneNode(true);
    clone.querySelectorAll('h3, [role="button"]').forEach(el => el.remove());
    const fullClean = (clone.innerText || "").trim();

    const winner = longestDirAuto.length >= fullClean.length ? longestDirAuto : fullClean;

    return {
      idx: i,
      hasArticleAncestor: !!ancestor,
      permaHref: permaHref ? permaHref.slice(0, 120) : null,
      post_id: post_id,
      commentFlag: commentFlag,
      lenDirAuto: longestDirAuto.length,
      lenFullClean: fullClean.length,
      snippet: winner.slice(0, 200)
    };
  });
}
"""


def main() -> int:
    with attached_browser(9222) as (_, port):
        tabs = list_group_pages(port)
        if not tabs:
            print("(keine FB-Group-Tabs im Chrome offen)")
            return 1
        for page, group in tabs:
            print(f"=== Tab: {page.url[:80]}  (Gruppe: {group.name}) ===")
            data = page.evaluate(DIAG_JS)
            print(f"Articles: {len(data)}")
            for r in data:
                print(json.dumps(r, ensure_ascii=False))
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
