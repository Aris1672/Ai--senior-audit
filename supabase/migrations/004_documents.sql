CREATE TYPE doc_status AS ENUM ('uploading', 'processing', 'ready', 'error');

CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES profiles(id),
  session_id   UUID REFERENCES audit_sessions(id),
  file_name    TEXT NOT NULL,
  file_type    TEXT NOT NULL,
  file_size    INTEGER,
  storage_path TEXT NOT NULL,
  status       doc_status DEFAULT 'uploading',
  parsed_data  JSONB,
  page_count   INTEGER,
  error_msg    TEXT,
  uploaded_at  TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_own_docs" ON documents FOR ALL
  USING (client_id = auth.uid());
CREATE POLICY "admin_all_docs"  ON documents FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));