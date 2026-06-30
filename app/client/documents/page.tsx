"use client";


import { useEffect, useRef, useState } from "react";

interface Document {
  id:          string;
  file_name:   string;
  file_type:   string;
  file_size:   number;
  status:      string;
  uploaded_at: string;
}

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  uploading:  { label: "Загрузка...",  color: "#7a90c0" },
  processing: { label: "Обработка...", color: "#f59e0b" },
  ready:      { label: "Готов",        color: "#2ecc8f" },
  error:      { label: "Ошибка",       color: "#e84040" },
};

const TYPE_ICON: Record<string, string> = {
  pdf: "📄", xlsx: "📊", xls: "📊", docx: "📝", doc: "📝",
  csv: "📋", xml: "🔧", image: "🖼️", "1c_txt": "🏦",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function DocumentsPage() {
  const [docs,      setDocs]      = useState<Document[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clientId,  setClientId]  = useState<string | null>(null);
  const [dragOver,  setDragOver]  = useState(false);
  const fileRef  = useRef<HTMLInputElement>(null);
 

  async function loadDocs(uid: string) {
  const res  = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "client_documents", payload: { clientId: uid } }),
  });
  const data = await res.json();
  setDocs(data || []);
  setLoading(false);
}

useEffect(() => {
  async function init() {
    // Get user via Vercel — not directly from Russia to Supabase
    const meRes = await fetch("/api/auth/me");
    const { user } = await meRes.json();
    if (!user) return;
    setClientId(user.id);

    const sessionRes = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_or_create_session", payload: { clientId: user.id } }),
    });
    const { sessionId: sid } = await sessionRes.json();
    setSessionId(sid);
    await loadDocs(user.id);
  }
  init();
}, []);

  async function uploadFile(file: File) {
    if (!clientId || !sessionId) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file",      file);
    formData.append("clientId",  clientId);
    formData.append("sessionId", sessionId);

    await fetch("/api/upload", { method: "POST", body: formData });
    await loadDocs(clientId);
    setUploading(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  return (
    <div>
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#e8edf8", margin: 0 }}>
          Документы
        </h1>
        <p style={{ color: "#7a90c0", fontSize: "14px", marginTop: "6px" }}>
          Загрузите документы для анализа: PDF, XLSX, XLS, DOCX, DOC, CSV, XML, TXT (1C), JPG, PNG
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true);  }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border:       `2px dashed ${dragOver ? "#1565e8" : "#1e2d55"}`,
          borderRadius: "12px",
          padding:      "48px",
          textAlign:    "center",
          cursor:       "pointer",
          background:   dragOver ? "#0d1f3e" : "#0c1220",
          marginBottom: "24px",
          transition:   "all 0.2s",
        }}
      >
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>↑</div>
        <div style={{ color: "#e8edf8", fontSize: "15px", fontWeight: "500", marginBottom: "6px" }}>
          {uploading ? "Загрузка..." : "Перетащите файл или нажмите для выбора"}
        </div>
        <div style={{ color: "#7a90c0", fontSize: "13px" }}>
          PDF, XLSX, XLS, DOCX, DOC, CSV, XML, TXT (1C), JPG, PNG · Максимум 50MB
        </div>
        <input
          ref={fileRef} type="file" style={{ display: "none" }}
          accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.xml,.txt,.jpg,.jpeg,.png"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
        />
      </div>

      {/* Documents list */}
      <div style={{ background: "#0c1220", border: "1px solid #1e2d55", borderRadius: "10px", overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr",
          padding: "12px 20px", background: "#080c18",
          borderBottom: "1px solid #1e2d55",
          fontSize: "11px", color: "#3d4f7a", letterSpacing: "0.08em",
        }}>
          <span>ФАЙЛ</span><span>ТИП</span><span>РАЗМЕР</span><span>СТАТУС</span>
        </div>

        {loading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#7a90c0" }}>Загрузка...</div>
        ) : docs.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#7a90c0" }}>
            Документов пока нет. Загрузите первый файл.
          </div>
        ) : docs.map((doc, i) => {
          const st = STATUS_STYLE[doc.status] || STATUS_STYLE.ready;
          return (
            <div key={doc.id} style={{
              display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr",
              padding: "14px 20px", alignItems: "center",
              borderBottom: i < docs.length - 1 ? "1px solid #1a2340" : "none",
              fontSize: "13px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>{TYPE_ICON[doc.file_type] || "📄"}</span>
                <div>
                  <div style={{ color: "#e8edf8", fontWeight: "500" }}>{doc.file_name}</div>
                  <div style={{ color: "#7a90c0", fontSize: "11px" }}>
                    {new Date(doc.uploaded_at).toLocaleString("ru")}
                  </div>
                </div>
              </div>
              <span style={{ color: "#7a90c0", textTransform: "uppercase", fontSize: "11px" }}>
                {doc.file_type}
              </span>
              <span style={{ color: "#7a90c0" }}>{formatBytes(doc.file_size || 0)}</span>
              <span style={{
                fontSize: "11px", fontWeight: "600", color: st.color,
              }}>
                {st.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}