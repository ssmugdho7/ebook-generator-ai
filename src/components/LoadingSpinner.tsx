"use client";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export default function LoadingSpinner({ size = "md", label }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-10 w-10",
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <div className={`${sizeClasses[size]} animate-spin rounded-full border-2 border-slate-600`} />
        <div className={`absolute inset-0 ${sizeClasses[size]} animate-spin rounded-full border-2 border-transparent border-t-blue-500`} />
      </div>
      {label && <span className="text-sm text-slate-400">{label}</span>}
    </div>
  );
}
