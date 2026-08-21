"use client";

interface DownloadProgressModalProps {
  isOpen: boolean;
  progress: number;
  status: string;
}

export default function DownloadProgressModal({
  isOpen,
  progress,
  status,
}: DownloadProgressModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Generating your PDF
        </h3>
        <p className="mb-4 text-sm text-text-muted">{status}</p>
        <div className="h-3 w-full overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-right text-xs text-text-muted">
          {progress}%
        </p>
      </div>
    </div>
  );
}
