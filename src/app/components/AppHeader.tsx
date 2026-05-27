"use client";

import { Sparkles, Wand2, Radio } from "lucide-react";
import type { Mode } from "@/lib/materials";

interface AppHeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

export default function AppHeader({ mode, onModeChange }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-white px-4 h-[56px] shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-primary)] to-[#818CF8] shadow-[var(--shadow-sm)]">
          <Sparkles className="size-4 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight text-[var(--color-text)]">AITuber Maker</span>
          <span className="text-[10px] font-medium text-[var(--color-text-muted)] leading-none -mt-0.5 hidden sm:block">mouth asset generator</span>
        </div>
      </div>

      {/* Mode Tabs */}
      <nav className="flex rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-bg-deep)] p-1">
        <ModeTab
          active={mode === "materials"}
          icon={<Wand2 className="size-3.5" />}
          label="素材生成"
          onClick={() => onModeChange("materials")}
        />
        <ModeTab
          active={mode === "streaming"}
          icon={<Radio className="size-3.5" />}
          label="配信モード"
          onClick={() => onModeChange("streaming")}
        />
      </nav>

      {/* Spacer for symmetry */}
      <div className="w-[120px]" />
    </header>
  );
}

function ModeTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactElement;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`
        flex items-center gap-1.5 rounded-[var(--radius-full)] px-4 py-1.5 text-xs font-semibold
        transition-all duration-[var(--transition-fast)]
        ${
          active
            ? "bg-white text-[var(--color-text)] shadow-[var(--shadow-sm)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        }
      `.trim()}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
