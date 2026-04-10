ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;

ALTER TABLE public.quotes
ADD CONSTRAINT quotes_status_check
CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'final'::text]));