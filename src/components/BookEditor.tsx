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

const CODE_RE = /\b(programming|coding|code|developer|engineer|software|script|api|database|python|javascript|typescript|java|ruby|golang|rust|swift|kotlin|html|css|react|angular|vue|node|django|flask|fastapi|spring|rails|algorithm|function|variable|class|method|loop|array|object|json|yaml|git|docker|kubernetes|aws|azure|gcp|linux|terminal|command.line|cli|debug|compile|runtime|frontend|backend|fullstack|devops|testing|machine.learning|data.science|neural|model|train|predict|deploy|framework|library|package|module|dependency|npm|pip|maven|gradle)\b/i;

function isCodeTopic(book: Book): boolean {
  const text = `${book.title || ""} ${book.subtitle || ""}`;
  if (CODE_RE.test(text)) return true;
  for (const sec of book.sections || []) {
    for (const b of sec.blocks || []) {
      if (b.type === "code") return true;
    }
  }
  return false;
}

interface QuickAction {
  id: EditAction;
  label: string;
  needsCode: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "simplify", label: "Simplify", needsCode: false },
  { id: "expand", label: "Expand", needsCode: false },
  { id: "improve", label: "Improve", needsCode: false },
  { id: "add_examples", label: "Add Example", needsCode: true },
  { id: "add_code", label: "Add Code", needsCode: true },
  { id: "add_diagram", label: "Add Diagram", needsCode: true },
  { id: "regenerate", label: "Regenerate", needsCode: true },
  { id: "add_quiz", label: "Add Quiz", needsCode: true },
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
      // Combine quick action with any custom instruction the user typed
      const effectiveInstruction = customInstruction || instruction.trim() || undefined;
      setIsEditing(true);
      setEditingAction(action);
      setError(null);
      try {
        const res = await editSection({
          ebook_id: ebookId,
          book,
          section_index: selectedIndex,
          action,
          instruction: effectiveInstruction,
          language,
        });
        undoRef.current = book;
        setCanUndo(true);
        onBookChange(res.book);
      } catch (e) {
        setError(e instanceof Error ? e.message : "AI edit is temporarily unavailable. Please try again.");
      } finally {
        setIsEditing(false);
        setEditingAction(null);
      }
    },
    [isEditing, ebookId, book, selectedIndex, language, onBookChange, instruction]
  );

  const handleUndo = useCallback(() => {
    if (!undoRef.current) return;
    onBookChange(undoRef.current);
    undoRef.current = null;
    setCanUndo(false);
    setError(null);
  }, [onBookChange]);

  const codeTopic = isCodeTopic(book);
  const selectedTitle = sections[selectedIndex]?.title || "";

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
      {/* LEFT: section list / TOC — height-capped on mobile so the preview
          and AI controls are never pushed far below the fold. */}
      <div className="rounded-2xl border border-card-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Sections</h3>
        <ul className="max-h-52 space-y-1 overflow-y-auto lg:max-h-none">
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
            <iframe title="Book preview" srcDoc={previewHtml} className="h-full w-full border-0" style={{ overflow: "auto" }} />
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
          {QUICK_ACTIONS.map((a) => {
            const disabled = isEditing || (a.needsCode && !codeTopic);
            return (
              <button
                key={a.id}
                onClick={() => runEdit(a.id)}
                disabled={disabled}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                  disabled
                    ? "cursor-not-allowed border-card-border bg-background/50 text-text-muted/40"
                    : "border-card-border bg-background text-foreground hover:border-accent/40 hover:text-accent"
                }`}
                title={a.needsCode && !codeTopic ? "Not available for non-programming books" : undefined}
              >
                {a.label}
              </button>
            );
          })}
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
