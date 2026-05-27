"use client";

import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export default function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`
        rounded-[var(--radius-lg)] border border-[var(--color-border)]
        bg-white shadow-[var(--shadow-xs)]
        ${className}
      `.trim()}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  icon?: ReactNode;
  title: string;
  badge?: string;
  badgeVariant?: "default" | "success" | "warning" | "error" | "active";
  stepNumber?: number;
  stepComplete?: boolean;
  children?: ReactNode;
}

const badgeVariantClasses: Record<string, string> = {
  default: "bg-[var(--color-bg-deep)] text-[var(--color-text-secondary)]",
  success: "bg-[var(--color-success-light)] text-[var(--color-success)]",
  warning: "bg-[var(--color-warning-light)] text-[var(--color-warning)]",
  error: "bg-[var(--color-error-light)] text-[var(--color-error)]",
  active: "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
};

export function CardHeader({ icon, title, badge, badgeVariant = "default", stepNumber, stepComplete, children }: CardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)]">
      <div className="flex items-center gap-2.5 min-w-0">
        {stepNumber != null && (
          <span
            className={`
              flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold
              transition-all duration-300
              ${
                stepComplete
                  ? "bg-[var(--color-success)] text-white animate-check-pop"
                  : "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
              }
            `.trim()}
          >
            {stepComplete ? "✓" : stepNumber}
          </span>
        )}
        {icon && !stepNumber && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-light)] text-[var(--color-primary)]">
            {icon}
          </span>
        )}
        <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">{title}</h3>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge && (
          <span className={`max-w-[180px] truncate rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-medium ${badgeVariantClasses[badgeVariant]}`}>
            {badge}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
