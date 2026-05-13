#!/usr/bin/env python3
"""Findet die DOM-Wrapper-Elemente für FB-Top-Level-Posts.

Strategie: für jeden /groups/.../posts/<id>/-Permalink im DOM, wandere im
Tree hoch bis zu einem Wrapper, der genug Text enthält (>200 Zeichen) — das
ist mit hoher Wahrscheinlichkeit der Post-Container. Logge dessen Tag,
role-Attribut, data-pagelet-Attribut, und die ersten Klassen.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.cdp_attach import attached_browser, list_group_pages  # noqa: E402

DIAG_JS = r"""
() => {
  // Alle /posts/<digits>/ Links ohne ?comment_id (= echte Post-Permalinks)
  const links = Array.from(document.querySelectorAll('a[href*="/groups/"][href*="/posts/"]'))
    .filter(a => !/[?&]comment_id=/.test(a.href));

  // dedup per post_id
  const byPostId = new Map();
  for (const a of links) {
    const m = a.href.match(/\/posts\/([0-9]+)/);
    if (!m) continue;
    if (!byPostId.has(m[1])) byPostId.set(m[1], a);
  }

  const results = [];
  for (const [post_id, a] of byPostId) {
    // Hochwandern: ersten Vorfahren mit >200 Zeichen innerText finden
    let node = a;
    let wrapper = null;
    for (let i = 0; i < 30 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const len = (node.innerText || "").trim().length;
      if (len > 200) {
        wrapper = node;
        break;
      }
    }
    if (!wrapper) continue;

    // Wrapper-Metadaten
    const info = {
      post_id: post_id,
      permaHref: a.href.slice(0, 100),
      wrapperTag: wrapper.tagName.toLowerCase(),
      wrapperRole: wrapper.getAttribute('role'),
      wrapperPagelet: wrapper.getAttribute('data-pagelet') || wrapper.getAttribute('data-virtualized'),
      wrapperClassPrefix: (wrapper.className || '').slice(0, 60),
      wrapperHasAriaLabel: !!wrapper.getAttribute('aria-label'),
      wrapperTextLen: (wrapper.innerText || '').trim().length,
      // Ist dieser Wrapper selbst ein [role="article"]?
      isRoleArticle: wrapper.getAttribute('role') === 'article',
      // Hat er einen role=article-Vorfahren?
      hasArticleAncestor: !!wrapper.parentElement?.closest('[role="article"]'),
      // Snippet
      snippet: (wrapper.innerText || '').trim().slice(0, 250)
    };
    results.push(info);
  }
  return results;
}
"""


def main() -> int:
    with attached_browser(9222) as (_, port):
        tabs = list_group_pages(port)
        if not tabs:
            print("(keine FB-Group-Tabs offen)")
            return 1
        for page, group in tabs:
            print(f"=== {page.url[:80]}  ({group.name}) ===")
            data = page.evaluate(DIAG_JS)
            print(f"Wrappers gefunden: {len(data)}")
            for r in data:
                print(json.dumps(r, ensure_ascii=False))
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
