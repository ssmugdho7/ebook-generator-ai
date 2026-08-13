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
