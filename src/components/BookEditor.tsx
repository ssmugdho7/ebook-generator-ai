"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  getBookPreview,
  editSection,
  type Book,
  type EditAction,
  type EbookLanguage,
} from "@/lib/api";

interface BookEditorProps {
  book: Book;
  ebookId?: string | null;
  templateId: string;
  language: EbookLanguage;
  coverImage?: string | null;
  onBookChange: (book: Book) => void;
}

const QUICK_ACTIONS: { id: EditAction; label: string }[] = [
  { id: "simplify", label: "Simplify" },
  { id: "expand", label: "Expand" },
  { id: "improve", label: "Improve" },
  { id: "add_examples", label: "Add Example" },
  { id: "add_code", label: "Add Code" },
  { id: "add_diagram", label: "Add Diagram" },
  { id: "regenerate", label: "Regenerate" },
  { id: "add_quiz", label: "Add Quiz" },
];

export default function BookEditor({
  book,
  ebookId,
  templateId,
  language,
  coverImage,
  onBookChange,
}: BookEditorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewHtml, setPreviewHtml] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editingAction, setEditingAction] = useState<EditAction | null>(null);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);

  // One-level undo: keep the last book before an AI edit.
  const undoRef = useRef<Book | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const sections = book.sections || [];

  const refreshPreview = useCallback(async () => {
    try {
      const html = await getBookPreview(book, templateId, coverImage ?? null);
      setPreviewHtml(html);
    } catch {
      /* preview is best-effort; keep the last good render */
    }
  }, [book, templateId, coverImage]);

  useEffect(() => {
    // async fetch -> setState happens after await, not synchronously; this is safe
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPreview();
  }, [refreshPreview]);

  const runEdit = useCallback(
    async (action: EditAction, customInstruction?: string) => {
      if (isEditing) return;
      setIsEditing(true);
      setEditingAction(action);
      setError(null);
      try {
        const res = await editSection({
          ebook_id: ebookId,
          book,
          section_index: selectedIndex,
          action,
          instruction: customInstruction,
          language,
        });
        undoRef.current = book;
        setCanUndo(true);
        onBookChange(res.book);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Section edit failed");
      } finally {
        setIsEditing(false);
        setEditingAction(null);
      }
    },
    [isEditing, ebookId, book, selectedIndex, language, onBookChange]
  );

  const handleUndo = useCallback(() => {
    if (!undoRef.current) return;
    onBookChange(undoRef.current);
    undoRef.current = null;
    setCanUndo(false);
    setError(null);
  }, [onBookChange]);

  const selectedTitle = sections[selectedIndex]?.title || "";

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
      {/* LEFT: section list / TOC */}
      <div className="rounded-2xl border border-card-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Sections</h3>
        <ul className="space-y-1">
          {sections.map((sec, i) => (
            <li key={i}>
              <button
                onClick={() => setSelectedIndex(i)}
                className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-accent/15 font-medium text-accent"
                    : "text-text-muted hover:bg-background hover:text-foreground"
                }`}
                title={sec.title}
              >
                <span className="mr-2 text-xs opacity-60">{i + 1}.</span>
                {sec.title || `Section ${i + 1}`}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* CENTER: preview */}
      <div className="rounded-2xl border border-card-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Live Preview{isEditing ? ` · editing “${selectedTitle}”…` : ""}
          </h3>
          {canUndo && (
            <button
              onClick={handleUndo}
              disabled={isEditing}
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              ↩ Undo
            </button>
          )}
        </div>
        <div className="h-[70vh] overflow-hidden rounded-xl border border-card-border bg-white">
          {previewHtml ? (
            <iframe title="Book preview" srcDoc={previewHtml} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              <LoadingSpinner size="sm" />
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: AI controls */}
      <div className="rounded-2xl border border-card-border bg-card p-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">AI Edit</h3>
        <p className="mb-3 text-xs text-text-muted">
          Editing: <span className="text-accent">{selectedTitle || "—"}</span>
        </p>

        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => runEdit(a.id)}
              disabled={isEditing}
              className="rounded-lg border border-card-border bg-background px-2 py-2 text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold text-foreground">
            Custom instruction
          </label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={isEditing}
            placeholder="Explain this section for a complete beginner…"
            className="h-24 w-full resize-none rounded-lg border border-card-border bg-background p-3 text-sm text-foreground placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <button
            onClick={() => runEdit("edit", instruction.trim() || undefined)}
            disabled={isEditing}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isEditing && editingAction ? (
              <>
                <LoadingSpinner size="sm" /> Working…
              </>
            ) : (
              "Apply AI Edit"
            )}
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
