
-- Create storage bucket for technical sheets
INSERT INTO storage.buckets (id, name, public)
VALUES ('techsheets', 'techsheets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read techsheets"
ON storage.objects FOR SELECT
USING (bucket_id = 'techsheets');

-- Allow public upload
CREATE POLICY "Public upload techsheets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'techsheets');

-- Allow public update
CREATE POLICY "Public update techsheets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'techsheets');

-- Allow public delete
CREATE POLICY "Public delete techsheets"
ON storage.objects FOR DELETE
USING (bucket_id = 'techsheets');
