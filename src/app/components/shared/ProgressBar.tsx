"use client";

interface ProgressBarProps {
  value: number; // 0-1
  animated?: boolean;
  className?: string;
}

export default function ProgressBar({ value, animated = false, className = "" }: ProgressBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <div className={`relative h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-deep)] ${className}`}>
      <div
        className={`
          h-full rounded-full transition-all duration-500 ease-out
          bg-gradient-to-r from-[var(--color-primary)] to-[#818CF8]
          ${animated && pct > 0 && pct < 100 ? "animate-pulse-progress" : ""}
        `.trim()}
        style={{ width: `${pct}%` }}
      />
      {animated && pct > 0 && pct < 100 && (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
          style={{
            width: `${pct}%`,
            animation: "shimmer 2s ease-in-out infinite",
            backgroundSize: "200% 100%",
          }}
        />
      )}
    </div>
  );
}
