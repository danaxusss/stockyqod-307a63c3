-- Unify Stocky and catalogue product data around public.products.
-- catalog_products remains the per-company catalogue membership/settings table;
-- its duplicated shared columns are kept synchronized during the compatibility window.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image text;

COMMENT ON COLUMN public.products.image IS
  'Canonical primary product image: bundled catalogue filename or product-photos storage path.';

-- Attach the existing catalogue image when every company copy agrees and the
-- Stocky master does not already have a primary image.
WITH catalogue_images AS (
  SELECT ref, min(image) AS image
  FROM public.catalog_products
  WHERE nullif(btrim(image), '') IS NOT NULL
  GROUP BY ref
  HAVING count(DISTINCT image) = 1
)
UPDATE public.products AS p
SET image = ci.image,
    updated_at = now()
FROM catalogue_images AS ci
WHERE p.barcode = ci.ref
  AND nullif(btrim(p.image), '') IS NULL;

-- Exact barcode/ref identity is deliberate. Do not normalize punctuation for
-- this relationship: the live data contains valid normalized collisions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalog_products_ref_products_fkey'
      AND conrelid = 'public.catalog_products'::regclass
  ) THEN
    ALTER TABLE public.catalog_products
      ADD CONSTRAINT catalog_products_ref_products_fkey
      FOREIGN KEY (ref) REFERENCES public.products(barcode)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

-- Stocky wins for all shared fields. These legacy columns remain populated so
-- an older deployed frontend cannot show stale catalogue values during rollout.
UPDATE public.catalog_products AS cp
SET designation = p.name,
    price = p.price,
    price_pro = p.reseller_price,
    image = p.image,
    updated_at = now()
FROM public.products AS p
WHERE cp.ref = p.barcode
  AND (
    cp.designation IS DISTINCT FROM p.name OR
    cp.price IS DISTINCT FROM p.price OR
    cp.price_pro IS DISTINCT FROM p.reseller_price OR
    cp.image IS DISTINCT FROM p.image
  );

CREATE OR REPLACE FUNCTION public.sync_product_master_to_catalogue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.catalog_products
  SET designation = NEW.name,
      price = NEW.price,
      price_pro = NEW.reseller_price,
      image = NEW.image,
      updated_at = now()
  WHERE ref = NEW.barcode
    AND (
      designation IS DISTINCT FROM NEW.name OR
      price IS DISTINCT FROM NEW.price OR
      price_pro IS DISTINCT FROM NEW.reseller_price OR
      image IS DISTINCT FROM NEW.image
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_product_master_to_catalogue ON public.products;
CREATE TRIGGER sync_product_master_to_catalogue
  AFTER UPDATE OF name, price, reseller_price, image ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_master_to_catalogue();

-- Atomic catalogue editor operation: shared fields update products while only
-- presentation metadata remains on the catalogue row.
CREATE OR REPLACE FUNCTION public.update_catalogue_product_master(
  p_catalog_id uuid,
  p_patch jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ref text;
BEGIN
  SELECT ref INTO v_ref
  FROM public.catalog_products
  WHERE id = p_catalog_id;

  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Catalogue product % not found', p_catalog_id;
  END IF;

  UPDATE public.products
  SET name = CASE
        WHEN p_patch ? 'designation' THEN coalesce(nullif(btrim(p_patch ->> 'designation'), ''), name)
        ELSE name
      END,
      brand = CASE
        WHEN p_patch ? 'brand' THEN coalesce(p_patch ->> 'brand', '')
        ELSE brand
      END,
      price = CASE
        WHEN p_patch ? 'price' THEN coalesce((p_patch ->> 'price')::numeric, 0)
        ELSE price
      END,
      reseller_price = CASE
        WHEN p_patch ? 'price_pro' THEN coalesce((p_patch ->> 'price_pro')::numeric, 0)
        ELSE reseller_price
      END,
      image = CASE
        WHEN p_patch ? 'image' THEN nullif(p_patch ->> 'image', '')
        ELSE image
      END
  WHERE barcode = v_ref;

  UPDATE public.catalog_products
  SET family_id = CASE
        WHEN p_patch ? 'family_id' THEN nullif(p_patch ->> 'family_id', '')::uuid
        ELSE family_id
      END,
      hidden = CASE
        WHEN p_patch ? 'hidden' THEN coalesce((p_patch ->> 'hidden')::boolean, false)
        ELSE hidden
      END,
      sort_order = CASE
        WHEN p_patch ? 'sort_order' THEN coalesce((p_patch ->> 'sort_order')::integer, 0)
        ELSE sort_order
      END
  WHERE id = p_catalog_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_catalogue_product_master(
  p_company_id uuid,
  p_ref text,
  p_family_id uuid DEFAULT NULL,
  p_designation text DEFAULT NULL,
  p_price numeric DEFAULT 0,
  p_price_pro numeric DEFAULT 0,
  p_image text DEFAULT NULL,
  p_hidden boolean DEFAULT false,
  p_sort_order integer DEFAULT 0
)
RETURNS public.catalog_products
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ref text := btrim(p_ref);
  v_master public.products%ROWTYPE;
  v_catalog public.catalog_products%ROWTYPE;
BEGIN
  IF v_ref = '' THEN
    RAISE EXCEPTION 'Product reference is required';
  END IF;

  INSERT INTO public.products (
    barcode, name, brand, image, techsheet, price, buyprice,
    reseller_price, provider, stock_levels
  ) VALUES (
    v_ref, coalesce(nullif(btrim(p_designation), ''), v_ref), '', p_image, '',
    coalesce(p_price, 0), 0, coalesce(p_price_pro, 0), '', '{}'::jsonb
  )
  ON CONFLICT (barcode) DO NOTHING;

  SELECT * INTO v_master
  FROM public.products
  WHERE barcode = v_ref;

  INSERT INTO public.catalog_products (
    company_id, family_id, ref, designation, price, price_pro,
    image, hidden, sort_order
  ) VALUES (
    p_company_id, p_family_id, v_ref, v_master.name, v_master.price,
    v_master.reseller_price, v_master.image, p_hidden, p_sort_order
  )
  RETURNING * INTO v_catalog;

  RETURN v_catalog;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_catalogue_product_master(uuid, jsonb)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_catalogue_product_master(
  uuid, text, uuid, text, numeric, numeric, text, boolean, integer
) TO anon, authenticated;
