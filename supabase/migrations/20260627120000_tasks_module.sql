-- Tasks / Delivery module (ported from CuisiTask, unified onto this app's auth)
-- Reuses the existing public.app_users table for identity/auth.

-- 1) Per-user access switch, set by the super admin in User Management.
--    NULL  => no access to the Tasks/Delivery section.
--    value => the user's role *inside* the Tasks module.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS tasks_role TEXT
  CHECK (tasks_role IN ('sales', 'technician', 'driver'));

-- 2) Tasks (deliveries + technical interventions), company-scoped.
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'delivery',
  status TEXT NOT NULL DEFAULT 'pending',
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  problem_details TEXT,
  invoice_number TEXT,
  payment_details TEXT,
  comment TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  created_by TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  due_date TEXT,
  archived_at TIMESTAMPTZ,
  edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Task activity / audit trail.
CREATE TABLE public.task_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) Contacts (lived client-side in CuisiTask; promoted to a real, company-scoped table).
CREATE TABLE public.task_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role_label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Notifications (per-user, in-app bell).
CREATE TABLE public.task_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  task_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6) Tracking sessions: one-time public links so a client can track a delivery.
CREATE TABLE public.tracking_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  task_id UUID,
  driver_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  destination_latitude DOUBLE PRECISION,
  destination_longitude DOUBLE PRECISION,
  destination_source TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '12 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7) Driver location pings (realtime).
CREATE TABLE public.driver_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id TEXT NOT NULL,
  session_id UUID REFERENCES public.tracking_sessions(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: permissive policies, matching this app's pattern (tenant filtering is done client-side).
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all tasks" ON public.tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all task_activities" ON public.task_activities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all task_contacts" ON public.task_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all task_notifications" ON public.task_notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all tracking_sessions" ON public.tracking_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all driver_locations" ON public.driver_locations FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_tasks_company_id ON public.tasks(company_id);
CREATE INDEX idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_task_activities_task_id ON public.task_activities(task_id);
CREATE INDEX idx_task_contacts_company_id ON public.task_contacts(company_id);
CREATE INDEX idx_task_notifications_user_id ON public.task_notifications(user_id);
CREATE INDEX idx_tracking_sessions_token ON public.tracking_sessions(token);
CREATE INDEX idx_driver_locations_session_id ON public.driver_locations(session_id);

-- updated_at trigger on tasks (reuses the existing helper function)
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
