#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fill the WooCommerce CSV 'Images' column with REAL direct image URLs
(.jpg/.png/.webp), scraped from each product's official Eucerin page.

Run this on any machine WITH normal internet access:

    pip install requests
    python3 fill_images.py

Input : eucerin_woocommerce_import.csv   (Images column = official page URLs)
Output: eucerin_woocommerce_import_with_images.csv  (Images column = direct image links)

It extracts the page's og:image (the official packshot). If a page ever fails,
that row keeps its original reference URL and is printed as WARNING so you can
grab it by hand. Multiple images can be comma-separated in the final column.
"""

import csv, re, sys, time
import requests

IN  = "eucerin_woocommerce_import.csv"
OUT = "eucerin_woocommerce_import_with_images.csv"

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/124.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

OG_RE  = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', re.I)
OG_RE2 = re.compile(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', re.I)
IMG_RE = re.compile(r'https?://[^\s"\'<>]+\.(?:jpg|jpeg|png|webp)', re.I)

def direct_image(page_url):
    r = requests.get(page_url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    html = r.text
    for rx in (OG_RE, OG_RE2):
        m = rx.search(html)
        if m:
            url = m.group(1)
            if url.startswith("//"):
                url = "https:" + url
            return url
    # fallback: first plausible product image on the page
    m = IMG_RE.search(html)
    if m:
        return m.group(0)
    raise ValueError("no image found on page")

def main():
    with open(IN, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    fields = list(rows[0].keys())

    for i, row in enumerate(rows, 1):
        page = row.get("Images", "").strip()
        name = row.get("Name", "")
        if not page.startswith("http"):
            print(f"[{i:2}] SKIP (no page)  {name}")
            continue
        try:
            img = direct_image(page)
            row["Images"] = img
            print(f"[{i:2}] OK   {img}")
        except Exception as e:
            print(f"[{i:2}] WARNING  could not resolve image for '{name}': {e}")
            print(f"        -> left reference page in place: {page}")
        time.sleep(1.0)  # be polite

    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, quoting=csv.QUOTE_ALL)
        w.writeheader()
        w.writerows(rows)
    print(f"\nDone -> {OUT}")

if __name__ == "__main__":
    sys.exit(main())
