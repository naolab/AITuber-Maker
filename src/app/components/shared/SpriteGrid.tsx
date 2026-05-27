"use client";

import { Download, Upload } from "lucide-react";
import type { ChangeEvent } from "react";
import type { GeneratedSprite, MouthSpriteName } from "@/lib/materials";

interface SpriteGridProps {
  sprites: GeneratedSprite[];
  allNames: MouthSpriteName[];
  mode?: "download" | "upload";
  onUpload?: (name: MouthSpriteName) => (event: ChangeEvent<HTMLInputElement>) => void;
}

export default function SpriteGrid({ sprites, allNames, mode = "download", onUpload }: SpriteGridProps) {
  if (mode === "download" && !sprites.length) return null;

  return (
    <div className="grid grid-cols-5 gap-2 stagger-children">
      {allNames.map((name) => {
        const sprite = sprites.find((s) => s.name === name);

        if (mode === "upload") {
          return (
            <label
              className="group grid cursor-pointer gap-1.5 text-center text-[11px] font-medium text-[var(--color-text-secondary)]"
              key={name}
            >
              {sprite ? (
                <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-deep)] transition-all duration-200 group-hover:border-[var(--color-primary)] group-hover:shadow-[var(--shadow-sm)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="size-full object-contain p-1" src={sprite.url} alt={`${name} mouth`} />
                </div>
              ) : (
                <span className="grid aspect-square w-full place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-deep)] text-[var(--color-text-muted)] transition-all group-hover:border-[var(--color-primary)] group-hover:bg-[var(--color-primary-light)] group-hover:text-[var(--color-primary)]">
                  <Upload className="size-3.5" />
                </span>
              )}
              <span>{name}</span>
              <input className="sr-only" type="file" accept="image/png,image/*" onChange={onUpload?.(name)} />
            </label>
          );
        }

        if (!sprite) return null;
        return (
          <a
            className="group grid gap-1.5 text-center text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
            download={`${sprite.name}.png`}
            href={sprite.url}
            key={sprite.name}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-deep)] checkerboard transition-all duration-200 group-hover:border-[var(--color-primary)] group-hover:shadow-[var(--shadow-sm)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="size-full object-contain p-1" src={sprite.url} alt={`${name} mouth`} />
              <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
                <Download className="size-4 text-white drop-shadow-md" />
              </span>
            </div>
            <span>{sprite.name}</span>
          </a>
        );
      })}
    </div>
  );
}
