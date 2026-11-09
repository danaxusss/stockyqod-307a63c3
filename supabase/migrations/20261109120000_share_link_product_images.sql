-- Product photos on a quote's share link.
--
-- When technical sheets are joined to a quote, a product without a sheet is
-- represented by its photo instead. The link stores those photos
-- ([{barcode, name, brand, url}]) next to the sheet ids.
ALTER TABLE public.sheet_share_links
  ADD COLUMN IF NOT EXISTS product_images JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_share_links_product_images_array') THEN
    ALTER TABLE public.sheet_share_links
      ADD CONSTRAINT sheet_share_links_product_images_array
      CHECK (jsonb_typeof(product_images) = 'array' AND jsonb_array_length(product_images) <= 200);
  END IF;
END;
$$;
