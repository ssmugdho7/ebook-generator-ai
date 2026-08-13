const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
  targetPages: number
): Promise<{ book: Book; page_count: number; target_pages: number }> {
  return postJson("/api/generate-book", {
    content,
    template_id: templateId,
    target_pages: targetPages,
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
  templateId: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/download-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book, template_id: templateId }),
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
