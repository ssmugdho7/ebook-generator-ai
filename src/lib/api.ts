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
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : `${isLocal ? "http" : "https"}://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

const API_BASE = resolveApiBase();

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
}

/** A book translated into another language (e.g. Bengali). Same shape as Book. */
export type TranslatedBook = Book;

export type EbookLanguage = "en" | "bn" | "both";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export async function getTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch(`${API_BASE}/api/templates`);
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
  book_bn?: TranslatedBook | null;
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
): Promise<{ book: TranslatedBook; language: "bn"; template_id: string }> {
  return postJson("/api/translate-book", {
    book,
    template_id: templateId,
    target_pages: targetPages,
    language,
  });
}

export async function getBookPreview(
  book: Book,
  templateId: string
): Promise<string> {
  const data = await postJson<{ html: string }>("/api/preview", {
    book,
    template_id: templateId,
  });
  return data.html;
}

export async function downloadBookPdf(
  book: Book,
  templateId: string,
  ebookId?: string | null,
  language: "en" | "bn" = "en"
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/download-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      book,
      template_id: templateId,
      ebook_id: ebookId ?? null,
      language,
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
  book_bn?: TranslatedBook | null;
}

export async function getLibrary(
  limit = 12
): Promise<{ items: LibraryItem[]; database: boolean }> {
  const res = await fetch(`${API_BASE}/api/library?limit=${limit}`);
  if (!res.ok) return { items: [], database: false };
  return res.json();
}

export async function getLibraryBook(
  id: string
): Promise<{ id: string; book: Book; page_count: number | null }> {
  const res = await fetch(`${API_BASE}/api/library/${id}`);
  if (!res.ok) throw new Error("Could not open that ebook");
  return res.json();
}

/** Instant download: the stored PDF is streamed from Postgres, no re-render. */
export async function downloadStoredPdf(id: string, title: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/library/${id}/pdf`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "PDF not stored yet" }));
    throw new Error(err.detail || "PDF not stored yet");
  }
  await saveBlobAsFile(res, fileNameFromTitle(title));
}

export async function deleteLibraryItem(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/library/${id}`, { method: "DELETE" });
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
