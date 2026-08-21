"use client";

interface GenerateProgressModalProps {
  isOpen: boolean;
}

export default function GenerateProgressModal({ isOpen }: GenerateProgressModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          <h3 className="text-lg font-semibold text-foreground">Generating your ebook</h3>
        </div>
        <p className="mt-3 text-sm text-text-muted">
          This usually takes a few seconds. The AI is writing your story,
          fetching images, and laying out the pages.
        </p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600"
            style={{ width: "60%", animation: "pulse 2s ease-in-out infinite" }}
          />
        </div>
      </div>
    </div>
  );
}
