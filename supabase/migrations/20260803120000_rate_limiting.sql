-- ============================================================================
-- Rate limiting for every Edge Function
--
-- Edge Functions are stateless and can run on many isolates at once, so the
-- counter has to live in Postgres to be shared and atomic. check_rate_limit()
-- does the increment and the verdict in ONE statement, so concurrent calls
-- can't slip past the limit (no read-then-write race).
--
-- Fixed-window counters: cheap, one row per (bucket, identifier, window).
--
-- Security: the table denies everyone via RLS with no policies. Only the
-- service_role (which bypasses RLS, and is what Edge Functions use) can touch
-- it, so a client holding the public anon key cannot read, inflate, or reset
-- anyone's counters.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket       TEXT        NOT NULL,          -- e.g. 'verify-pin:ip'
  identifier   TEXT        NOT NULL,          -- IP, username, user id…
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, identifier, window_start)
);

-- Used by the purge below.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits(window_start);

-- RLS on with NO policies = deny-all for anon/authenticated.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Belt and braces: no direct table rights for the public roles either.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- ── The limiter ─────────────────────────────────────────────────────────────
-- Returns: { allowed, count, remaining, retry_after }
-- The INSERT ... ON CONFLICT DO UPDATE is atomic, so `count` is exact even
-- when many requests arrive simultaneously.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket         TEXT,
  p_identifier     TEXT,
  p_max            INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INTEGER;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    p_window_seconds := 60;
  END IF;

  -- Align to the current fixed window. clock_timestamp() (not now(), which is
  -- frozen at transaction start) so windows advance by real elapsed time.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits AS rl (bucket, identifier, window_start, count)
  VALUES (p_bucket, coalesce(p_identifier, 'unknown'), v_window_start, 1)
  ON CONFLICT (bucket, identifier, window_start)
  DO UPDATE SET count = rl.count + 1
  RETURNING rl.count INTO v_count;

  RETURN jsonb_build_object(
    'allowed',     v_count <= p_max,
    'count',       v_count,
    'remaining',   greatest(0, p_max - v_count),
    'retry_after', greatest(1, ceil(extract(epoch FROM
                     (v_window_start + make_interval(secs => p_window_seconds)) - clock_timestamp()
                   ))::INTEGER)
  );
END;
$$;

-- Only Edge Functions (service_role) may consult the limiter. Without this an
-- attacker could burn a victim's quota — or probe it — using the public key.
REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

-- ── Housekeeping ────────────────────────────────────────────────────────────
-- Old windows are dead weight; functions call this occasionally (1% of calls).
CREATE OR REPLACE FUNCTION public.purge_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.rate_limits WHERE window_start < clock_timestamp() - INTERVAL '1 day';
$$;

REVOKE ALL ON FUNCTION public.purge_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_rate_limits() TO service_role;
