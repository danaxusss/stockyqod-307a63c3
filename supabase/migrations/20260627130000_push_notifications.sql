-- Web Push (VAPID) subscriptions + reminder tracking for the Tasks module.

CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all push_subscriptions" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

CREATE TRIGGER update_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Track reminder pushes so a missed/ignored notification is nudged only once.
ALTER TABLE public.task_notifications
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
