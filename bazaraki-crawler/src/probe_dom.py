"""Diagnose-Script: identifiziert die Quelle jedes media[]-Eintrags.

Öffnet eine Bazaraki-Detail-URL und evaluiert isoliert jede Strategie aus
crawler.py (JSON-LD, Galerie-Selektoren, background-image-Divs). Druckt für
jede Quelle die gefundenen Bild-URLs — so wird transparent woher z.B. ein
Makler-Logo in media[0] kommt.

Lokal: uv run python -m src.probe_dom <bazaraki-url>
CI:    via .github/workflows/probe-bazaraki-dom.yml
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

from .config import USER_AGENT


PROBE_JS = r"""
() => {
  const result = {
    json_ld: [],
    img_announcement_class: [],
    img_itemprop_image: [],
    img_in_announcement_images: [],
    img_in_announcement_slider: [],
    img_in_gallery: [],
    bg_image_all: [],
    bg_image_in_author_info: [],
    bg_image_in_gallery_wrapper: [],
    og_image: null,
    all_imgs_with_media_cache: [],
  };

  // 1) JSON-LD <script type=application/ld+json>
  try {
    const ldNodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (const node of ldNodes) {
      try {
        const parsed = JSON.parse(node.textContent || '{}');
        const imgs = parsed?.image;
        if (Array.isArray(imgs)) result.json_ld.push(...imgs);
        else if (typeof imgs === 'string') result.json_ld.push(imgs);
      } catch {}
    }
  } catch {}

  const pickUrl = (img) => {
    const ds = img.getAttribute('data-src');
    if (ds) return ds;
    const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (ss) {
      const parts = ss.split(',').map(s => s.trim()).filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return last.split(/\s+/)[0];
    }
    return img.src || null;
  };

  // 2) Verschiedene img-Selektoren
  const dump = (sel, key) => {
    const found = Array.from(document.querySelectorAll(sel));
    for (const img of found) {
      const u = pickUrl(img);
      if (u) result[key].push(u);
    }
  };
  dump('img.announcement__images-item, img.announcement-images-item', 'img_announcement_class');
  dump('img[itemprop="image"]', 'img_itemprop_image');
  dump('.announcement__images img, .announcement-images img', 'img_in_announcement_images');
  dump('.announcement__slider img, .announcement-slider img', 'img_in_announcement_slider');
  dump('.announcement-gallery img, .announcement__gallery img, .gallery img', 'img_in_gallery');

  // 3) Background-Image-Divs
  const bgDivs = document.querySelectorAll('[style*="background-image"]');
  for (const el of bgDivs) {
    const m = (el.getAttribute('style') || '').match(/background-image:\s*url\((["']?)([^"')]+)\1\)/i);
    if (!m || !m[2]) continue;
    const url = m[2];
    result.bg_image_all.push(url);
    if (el.closest('.author-info, .user-card, .seller-card, .vendor-card')) {
      result.bg_image_in_author_info.push(url);
    }
    if (el.closest('.announcement-gallery, .announcement__gallery, .gallery, .announcement__images, .announcement-images, .announcement__slider, .announcement-slider')) {
      result.bg_image_in_gallery_wrapper.push(url);
    }
  }

  // 4) og:image
  const og = document.querySelector('meta[property="og:image"]');
  result.og_image = og?.getAttribute('content') || null;

  // 5) ALLE <img> mit media/cache im src (Catch-all für Logo-Findung)
  const allImgs = document.querySelectorAll('img');
  for (const img of allImgs) {
    const u = pickUrl(img);
    if (u && /bazaraki\.com\/media\/cache/i.test(u)) {
      result.all_imgs_with_media_cache.push({
        url: u,
        class: img.className || '(no class)',
        itemprop: img.getAttribute('itemprop') || '(no itemprop)',
        alt: img.getAttribute('alt') || '(no alt)',
        parent_class: img.parentElement?.className || '(no parent class)',
        closest_section: (() => {
          const sections = ['author-info', 'announcement-gallery', 'announcement__gallery', 'gallery', 'user-card', 'seller-card'];
          for (const s of sections) {
            if (img.closest('.' + s)) return s;
          }
          return '(unknown section)';
        })(),
      });
    }
  }

  return result;
}
"""


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m src.probe_dom <bazaraki-url>", file=sys.stderr)
        sys.exit(2)
    url = sys.argv[1]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(user_agent=USER_AGENT)
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)

        # Best-effort warten — bei CF-Challenge oder Layout-Drift trotzdem evaluieren
        # statt hart fail'n. Wir wollen DIAGNOSE, nicht ein perfektes Listing.
        for sel in [
            '[itemprop="address"]',
            '.announcement-characteristics',
            'img[itemprop="image"]',
            'img.announcement__images-item',
        ]:
            try:
                page.wait_for_selector(sel, timeout=5_000)
                print(f"# wait OK: {sel}", flush=True)
                break
            except Exception:
                print(f"# wait timeout: {sel}", flush=True)

        # Diagnose-Info: HTTP-Status, Title, Body-Snippet
        title = page.title()
        body_text = page.locator("body").inner_text(timeout=2_000)[:500] if page.locator("body").count() else "(no body)"
        print(f"\n# title: {title}")
        print(f"# body[0:500]: {body_text!r}\n", flush=True)

        result = page.evaluate(PROBE_JS)
        browser.close()

    print(f"\n=== Bazaraki DOM Probe: {url} ===\n")
    for key, val in result.items():
        if isinstance(val, list):
            print(f"[{key}] {len(val)} entries")
            for entry in val[:5]:
                print(f"  - {entry}")
            if len(val) > 5:
                print(f"  ... +{len(val)-5} more")
        else:
            print(f"[{key}] {val}")
        print()


if __name__ == "__main__":
    main()
