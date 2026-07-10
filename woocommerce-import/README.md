# Eucerin → WooCommerce import

Generated from `Echant_09062026.xlsx` (28 Eucerin products, Moroccan market, prices in DH).

## Files
- `eucerin_woocommerce_import.csv` — ready to import via **WooCommerce › Products › Import**.
  Columns: `Type, Name, Short description, Description, Regular price, Categories, Images`.
  Descriptions in French. Set the store currency to **MAD (DH)** — prices are plain numbers.
  The `Images` column currently holds each product's **official Eucerin page URL** (reference),
  because the generating session had no outbound network access.
- `fill_images.py` — run where internet is available to replace the reference pages with
  **real direct image links** (`.jpg/.png/.webp`), producing
  `eucerin_woocommerce_import_with_images.csv`. Usage: `pip install requests && python3 fill_images.py`.
- `build_csv.py` — the script that generated the base CSV (names, descriptions, prices, categories).

## To finish (in a session/environment WITH network access)
Run `fill_images.py` to populate real image URLs, then import the resulting CSV into WooCommerce.
