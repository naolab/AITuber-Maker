"use client";

import { type ReactNode, type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] active:scale-[0.98]",
  secondary:
    "bg-[var(--color-dark)] hover:bg-[var(--color-dark-hover)] text-white shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] active:scale-[0.98]",
  outline:
    "border border-[var(--color-border)] bg-white hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] hover:border-[var(--color-text-muted)] active:scale-[0.98]",
  ghost:
    "bg-transparent hover:bg-[var(--color-bg-deep)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]",
  danger:
    "bg-[var(--color-error)] hover:bg-[#E11D48] text-white shadow-[var(--shadow-sm)] active:scale-[0.98]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5 rounded-[var(--radius-sm)]",
  md: "px-4 py-2.5 text-sm gap-2 rounded-[var(--radius-md)]",
  lg: "px-5 py-3 text-sm gap-2 rounded-[var(--radius-md)]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", icon, loading, children, className = "", disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={`
          inline-flex items-center justify-center font-semibold
          transition-all duration-[var(--transition-fast)]
          disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none
          ${variantClasses[variant]}
          ${sizeClasses[size]}
          ${className}
        `.trim()}
        disabled={disabled || loading}
        {...rest}
      >
        {loading ? (
          <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          icon
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
export default Button;
