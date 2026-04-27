"""DOM-Parser für FB-Group-Posts.

Wird in der Page via Playwright `page.evaluate()` ausgeführt. Sucht alle
`[role="article"]`-Elemente im aktuellen Viewport-Buffer (FB hält gerenderte
Posts ein paar Bildschirme weit cached) und extrahiert pro Post die
stabilen Felder.

**Bild-Qualität ist Pflicht** (Memory: feedback_image_quality):
1. `srcset` zuerst lesen, größte Pixelbreite-Variante wählen
2. Wenn `srcset` fehlt: `img.src` und FB-CDN-URL-Heuristik anwenden
3. Foto-Permalinks (`a[href*="/photo/?fbid="]`) als zusätzliche media-Quelle
4. Mindestbreite 720px für `media[0]` (Cover) — kleinere weiter hinten
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

# Mindestbreite für Cover-Bilder (Memory: feedback_image_quality)
MIN_COVER_WIDTH = 720


# In-Page-JS: extrahiert alle aktuell gerenderten Posts. Bleibt bewusst minimal —
# Python-Side macht alle Filter/Heuristik, damit Drift schnell isoliert ist.
EXTRACT_POSTS_JS = r"""
() => {
  const articles = Array.from(document.querySelectorAll('[role="article"]'));
  const out = [];

  for (const art of articles) {
    // Permalink: stabilster Anker. Posts haben einen Link mit /posts/<id>/ oder /permalink/<id>/.
    const permalinkEl = art.querySelector(
      'a[href*="/groups/"][href*="/posts/"], a[href*="/groups/"][href*="/permalink/"]'
    );
    if (!permalinkEl) continue;
    const permalink = permalinkEl.href;

    // Post-ID: aus /posts/<id>/ oder /permalink/<id>/
    const idMatch = permalink.match(/\/(?:posts|permalink)\/([0-9]+)/);
    if (!idMatch) continue;
    const post_id = idMatch[1];

    // Group-Token (numerische ID oder Slug) aus URL
    const groupMatch = permalink.match(/\/groups\/([^\/]+)\//);
    const group_token = groupMatch ? groupMatch[1] : null;

    // Autor: erster Profil-Link im Article-Header
    const authorEl = art.querySelector('h3 a[href*="/user/"], h3 strong a, h3 a');
    const author_name = authorEl?.textContent?.trim() || null;
    const author_href = authorEl?.href || null;
    // FB-User-ID aus author_href (numerische /user/<id>/ oder ?id=<id>)
    let author_id = null;
    if (author_href) {
      const m1 = author_href.match(/\/user\/([0-9]+)/);
      const m2 = !m1 ? author_href.match(/[?&]id=([0-9]+)/) : null;
      author_id = (m1 || m2)?.[1] || null;
    }

    // Timestamp — FB rendert das als <a><span>vor 3 Std.</span></a> mit aria-label oder
    // als <abbr title="Datum">; wir nehmen erstmal den Text und parsen Python-seitig.
    const timeEl = art.querySelector('a[aria-label*=":"][href*="/posts/"], a[href*="/posts/"] abbr, a[href*="/permalink/"] abbr');
    const time_text = timeEl?.getAttribute('aria-label') || timeEl?.getAttribute('title') || timeEl?.textContent?.trim() || null;

    // Post-Text: alle Text-Container, die nicht Header/Aktionsleiste/Kommentar sind.
    // FB rendert den Body als <div data-ad-preview="message"> ODER mehrere div-Wrapper —
    // wir greifen die längste Text-Block-Konzentration im Article.
    const candidates = Array.from(art.querySelectorAll('div[dir="auto"]'));
    let text = "";
    for (const c of candidates) {
      const t = c.innerText?.trim() || "";
      if (t.length > text.length) text = t;
    }
    if (!text || text.length < 20) continue;  // zu kurz → kein Inserat

    // Bilder: alle img-Elemente im Article. Wir extrahieren src + srcset + width
    // und entscheiden Python-seitig.
    const imgs = Array.from(art.querySelectorAll('img'))
      .filter(i => i.src && /scontent|fbcdn/i.test(i.src))
      .map(i => ({
        src: i.src,
        srcset: i.getAttribute('srcset') || null,
        width: i.naturalWidth || parseInt(i.getAttribute('width') || '0', 10) || null,
        height: i.naturalHeight || parseInt(i.getAttribute('height') || '0', 10) || null,
      }));

    // Foto-Permalinks (Lightbox-Links) als Fallback-media-Quelle
    const photo_links = Array.from(art.querySelectorAll('a[href*="/photo/?fbid="], a[href*="/photo.php?fbid="]'))
      .map(a => a.href)
      .filter((v, i, arr) => arr.indexOf(v) === i);  // dedup

    out.push({
      post_id,
      group_token,
      permalink,
      author_name,
      author_id,
      time_text,
      text,
      imgs,
      photo_links,
    });
  }

  return out;
}
"""


@dataclass
class RawPost:
    post_id: str
    group_token: str | None
    permalink: str
    author_name: str | None
    author_id: str | None        # FB-User-ID falls extractbar (für Blacklist)
    time_text: str | None        # roher Timestamp-Text, Python-seitig parsed
    text: str
    images: list[str] = field(default_factory=list)  # Cover an [0], hochauflösend
    photo_links: list[str] = field(default_factory=list)


def parse_posts(raw_records: list[dict[str, Any]]) -> list[RawPost]:
    """Konvertiert die JS-Rohdaten in RawPost-Records, mit Bild-Qualitäts-Pipeline."""
    posts: list[RawPost] = []
    for r in raw_records:
        try:
            images = _select_high_quality_images(r.get("imgs") or [])
            posts.append(RawPost(
                post_id=str(r["post_id"]),
                group_token=r.get("group_token"),
                permalink=r["permalink"],
                author_name=r.get("author_name"),
                author_id=r.get("author_id"),
                time_text=r.get("time_text"),
                text=r["text"],
                images=images,
                photo_links=list(r.get("photo_links") or []),
            ))
        except KeyError as e:
            log.warning("Skip raw record (missing key %s): %s", e, r)
    return posts


# ---------- Bild-Qualität ----------

# srcset: "url 720w, url 1080w" → [(url, 720), (url, 1080)]
_SRCSET_ENTRY = re.compile(r"\s*([^\s,]+)\s+(\d+)w\s*")

# FB-CDN-URLs enden auf _<size>.jpg/_<size>.png:
#   _s.jpg  =  130px      (small)
#   _n.jpg  =  720px      (normal)
#   _o.jpg  =  Original
_FB_SIZE_SUFFIX = re.compile(r"(_[a-z])(\.(?:jpe?g|png|webp))(\?|$)", re.IGNORECASE)


def _parse_srcset(srcset: str) -> list[tuple[str, int]]:
    return [(m.group(1), int(m.group(2))) for m in _SRCSET_ENTRY.finditer(srcset)]


def _rewrite_to_higher_res(url: str) -> str:
    """`_s.jpg` → `_n.jpg`. Nur als Last-Resort-Default wenn srcset nichts hergibt.

    Wir rewriten NICHT zu `_o.jpg`, weil das oft 404 zurückgibt — `_n.jpg` ist
    die zuverlässigste hochauflösende Variante.
    """
    return _FB_SIZE_SUFFIX.sub(lambda m: "_n" + m.group(2) + m.group(3), url)


def _resolution_score(url: str, hint_width: int | None) -> int:
    """Heuristische Auflösungs-Schätzung für Sortierung."""
    if hint_width:
        return hint_width
    # URL-Suffix-Hint
    m = _FB_SIZE_SUFFIX.search(url)
    if not m:
        return 0
    suffix = m.group(1).lower()
    return {"_o": 2000, "_n": 720, "_s": 130}.get(suffix, 100)


def _select_high_quality_images(imgs: list[dict[str, Any]]) -> list[str]:
    """Pro <img> die größte verfügbare Variante extrahieren, dann nach
    Auflösung absteigend sortieren. Cover (Index 0) muss ≥ MIN_COVER_WIDTH sein,
    sonst landen alle Bilder in Listen-Reihenfolge ohne Cover-Promotion."""
    candidates: list[tuple[str, int]] = []  # (url, score)
    seen: set[str] = set()

    for entry in imgs:
        src = entry.get("src") or ""
        srcset = entry.get("srcset") or ""
        width_hint = entry.get("width")

        best_url, best_score = None, -1

        if srcset:
            for url, w in _parse_srcset(srcset):
                if w > best_score:
                    best_url, best_score = url, w

        if best_url is None and src:
            rewritten = _rewrite_to_higher_res(src)
            best_url = rewritten
            best_score = _resolution_score(rewritten, width_hint)

        if best_url and best_url not in seen:
            seen.add(best_url)
            candidates.append((best_url, best_score))

    # Cover-Promotion: höchste Auflösung zuerst, aber nur wenn ≥ MIN_COVER_WIDTH
    candidates.sort(key=lambda x: x[1], reverse=True)
    cover_ok = candidates and candidates[0][1] >= MIN_COVER_WIDTH
    if not cover_ok and candidates:
        log.debug(
            "Kein Cover ≥ %dpx (höchste %dpx) — alle Bilder ohne Cover-Promotion",
            MIN_COVER_WIDTH, candidates[0][1],
        )

    return [url for url, _ in candidates[:24]]
