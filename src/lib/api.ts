/**
 * Backend base URL.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at build time. On Render it can be wired
 * straight from the API service (`fromService: property: host`), which yields a
 * bare hostname like `ebook-api.onrender.com` — so we add the scheme ourselves
 * and strip any trailing slash.
 */
function resolveApiBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (!raw) return "http://localhost:8000";
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(raw);
  let host = raw;
  if (!isLocal && !/^[a-z0-9-]+\.[a-z]{2,}/i.test(host)) {
    host += ".onrender.com";
  }
  const withScheme = /^https?:\/\//i.test(host)
    ? host
    : `${isLocal ? "http" : "https"}://${host}`;
  return withScheme.replace(/\/+$/, "");
}

const API_BASE = resolveApiBase();

/** Get auth token from localStorage (lazy import to avoid SSR issues). */
function _authToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ebook-auth-token");
}

/** Build headers with optional auth token. */
function _authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const tok = _authToken();
  if (tok) h["Authorization"] = `Bearer ${tok}`;
  return h;
}

export { API_BASE };

export async function generateEbook(
  content: string,
  theme: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/generate-ebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, theme }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Generation failed" }));
      throw new Error(err.detail || "Failed to generate ebook");
    }

    const data = await res.json();
    onChunk(data.markdown);
    onComplete();
  } catch (err) {
    onError(err instanceof Error ? err.message : "Request failed");
  }
}

export async function downloadPdf(
  content: string,
  theme: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/download-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, theme }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "PDF failed" }));
    throw new Error(err.detail || "Failed to download PDF");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ebook.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface TemplateInfo {
  id: string;
  label: string;
  dark: boolean;
  description: string;
  icon_style: string;
  code_style: string;
  fonts: { heading: string; body: string; mono: string };
  palette: {
    page_bg: string;
    accent: string;
    heading: string;
    text: string;
    code_bg: string;
    accent_soft?: string;
    muted?: string;
    block_bg?: string;
    code_text?: string;
    code_line?: string;
    title_page_bg?: string;
  };
}

export interface EbookBranding {
  enabled: boolean;
  company_name: string;
  logo_data: string;
  tagline: string;
  website: string;
  contact_text: string;
  copyright_text: string;
  footer_text: string;
  primary_color: string | null;
  secondary_color: string | null;
  about_enabled: boolean;
  about_description: string;
}

export interface Book {
  title: string;
  subtitle?: string;
  template_id: string;
  target_pages: number;
  sections: {
    title: string;
    title_scale?: "sm" | "lg";
    blocks: Record<string, unknown>[];
  }[];
  // Optional white-label branding. Application-controlled metadata — the AI
  // pipeline never reads or rewrites it; the backend validates it on every use.
  branding?: EbookBranding | null;
}

export type EbookLanguage = "en" | "bn";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: _authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export async function getTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch(`${API_BASE}/api/templates`, {
    headers: _authHeaders(),
  });
  if (!res.ok) {
    throw new Error("Failed to load templates");
  }
  const data = await res.json();
  return data.templates ?? [];
}

export async function generateBook(
  content: string,
  templateId: string,
  targetPages: number,
  language: EbookLanguage = "en"
): Promise<{
  book: Book;
  page_count: number;
  target_pages: number;
  language: EbookLanguage;
  ebook_id?: string | null;
}> {
  return postJson("/api/generate-book", {
    content,
    template_id: templateId,
    target_pages: targetPages,
    language,
  });
}

export async function translateBook(
  book: Book,
  templateId: string,
  targetPages: number,
  language: "bn" = "bn"
): Promise<{ book: Book; language: "bn"; template_id: string }> {
  return postJson("/api/translate-book", {
    book,
    template_id: templateId,
    target_pages: targetPages,
    language,
  });
}

export async function getBookPreview(
  book: Book,
  templateId: string,
  coverImage?: string | null
): Promise<string> {
  const data = await postJson<{ html: string }>("/api/preview", {
    book,
    template_id: templateId,
    cover_image: coverImage ?? null,
  });
  return data.html;
}

export async function downloadBookPdf(
  book: Book,
  templateId: string,
  ebookId?: string | null,
  language: "en" | "bn" = "en",
  coverImage?: string | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/download-pdf`, {
    method: "POST",
    headers: _authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      book,
      template_id: templateId,
      ebook_id: ebookId ?? null,
      language,
      cover_image: coverImage ?? null,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "PDF failed" }));
    throw new Error(err.detail || "Failed to download PDF");
  }

  await saveBlobAsFile(res, fileNameFromTitle(book.title));
}

/* -------------------------------------------------------------------------- */
/* Library (Neon-backed history)                                              */
/* -------------------------------------------------------------------------- */

export interface LibraryItem {
  id: string;
  title: string;
  subtitle?: string | null;
  template_id: string;
  target_pages: number;
  page_count: number | null;
  section_count: number;
  created_at: string | null;
  has_pdf: boolean;
  pdf_bytes: number | null;
}

export async function getLibrary(
  limit = 12
): Promise<{ items: LibraryItem[]; database: boolean }> {
  const res = await fetch(`${API_BASE}/api/library?limit=${limit}`, {
    headers: _authHeaders(),
  });
  if (!res.ok) return { items: [], database: false };
  return res.json();
}

export async function getLibraryBook(
  id: string
): Promise<{ id: string; book: Book; page_count: number | null }> {
  const res = await fetch(`${API_BASE}/api/library/${id}`, {
    headers: _authHeaders(),
  });
  if (!res.ok) throw new Error("Could not open that ebook");
  return res.json();
}

/** Instant download: the stored PDF is streamed from Postgres, no re-render. */
export async function downloadStoredPdf(id: string, title: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/library/${id}/pdf`, {
    headers: _authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "PDF not stored yet" }));
    throw new Error(err.detail || "PDF not stored yet");
  }
  await saveBlobAsFile(res, fileNameFromTitle(title));
}

export async function deleteLibraryItem(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/library/${id}`, {
    method: "DELETE",
    headers: _authHeaders(),
  });
  if (!res.ok) throw new Error("Could not delete that ebook");
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function fileNameFromTitle(title?: string): string {
  const slug = (title || "ebook")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "ebook"}.pdf`;
}

async function saveBlobAsFile(res: Response, filename: string): Promise<void> {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* Book Studio — section-level AI editing                                     */
/* -------------------------------------------------------------------------- */

export type EditAction =
  | "edit"
  | "simplify"
  | "expand"
  | "add_examples"
  | "add_code"
  | "add_diagram"
  | "improve"
  | "regenerate"
  | "add_quiz";

export interface EditSectionResponse {
  book: Book;
  section_index: number;
  section: Record<string, unknown>;
  action: EditAction;
  language: "en" | "bn";
  ebook_id?: string | null;
}

export async function editSection(payload: {
  ebook_id?: string | null;
  book: Book;
  section_index: number;
  action: EditAction;
  instruction?: string;
  language?: "en" | "bn";
}): Promise<EditSectionResponse> {
  const res = await fetch(`${API_BASE}/api/edit-section`, {
    method: "POST",
    headers: _authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      ebook_id: payload.ebook_id ?? null,
      book: payload.book,
      section_index: payload.section_index,
      action: payload.action,
      instruction: payload.instruction ?? null,
      language: payload.language ?? "en",
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Section edit failed" }));
    throw new Error(err.detail || "Section edit failed");
  }
  return res.json();
}

/* -------------------------------------------------------------------------- */
/* Business branding (white-label ebooks)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Upload a company logo and get back a normalized, validated PNG data URL.
 *
 * The client pre-resizes to keep uploads small; the server independently
 * re-validates and re-encodes the image (magic-byte sniffing, size caps,
 * PyMuPDF re-encode), so this is a convenience — not a security boundary.
 */
export async function uploadBrandLogo(file: Blob): Promise<string> {
  const res = await fetch(`${API_BASE}/api/branding/logo`, {
    method: "POST",
    headers: _authHeaders({ "Content-Type": "application/octet-stream" }),
    body: file,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Logo upload failed" }));
    throw new Error(err.detail || "Failed to upload logo");
  }
  const data = await res.json();
  return data.logo_data as string;
}

/**
 * Persist branding config server-side (owner-only) so it survives the browser.
 * Pass null to remove branding from a stored ebook entirely. Best-effort: the
 * studio still works offline via localStorage when this fails.
 */
export async function saveEbookBranding(
  ebookId: string,
  branding: EbookBranding | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/library/${encodeURIComponent(ebookId)}/branding`, {
    method: "POST",
    headers: _authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ branding }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Save failed" }));
    throw new Error(err.detail || "Failed to save branding");
  }
}
