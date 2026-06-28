-- C-4: Proof of completion — photo / signature captured when a task is done.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS proof_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Public storage bucket for proofs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-proofs', 'task-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Permissive storage policies for the bucket (internal app).
DROP POLICY IF EXISTS "task-proofs read"   ON storage.objects;
DROP POLICY IF EXISTS "task-proofs insert" ON storage.objects;
DROP POLICY IF EXISTS "task-proofs update" ON storage.objects;
CREATE POLICY "task-proofs read"   ON storage.objects FOR SELECT USING (bucket_id = 'task-proofs');
CREATE POLICY "task-proofs insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'task-proofs');
CREATE POLICY "task-proofs update" ON storage.objects FOR UPDATE USING (bucket_id = 'task-proofs') WITH CHECK (bucket_id = 'task-proofs');
