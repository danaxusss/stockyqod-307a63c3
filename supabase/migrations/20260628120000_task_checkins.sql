-- C-3: Team attendance — persist daily check-ins (was localStorage-only).
CREATE TABLE public.task_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  checkin_date DATE NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, checkin_date)
);

ALTER TABLE public.task_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all task_checkins" ON public.task_checkins FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_task_checkins_date ON public.task_checkins(checkin_date);
