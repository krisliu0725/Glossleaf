import * as React from "react";
import palettes from "./logo-palettes.json";

export type GlossleafPaletteId = typeof palettes[number]["id"];
export type GlossleafMarkProps = {
  palette?: GlossleafPaletteId;
  dark?: boolean;
  size?: number;
  title?: string;
  className?: string;
};

// One-piece logo: no detached bamboo leaves. The gap is genuine SVG transparency.
export function GlossleafMark({
  palette = "ink-vermilion", dark = false, size = 20,
  title = "Glossleaf", className,
}: GlossleafMarkProps) {
  const entry = palettes.find(p => p.id === palette) ?? palettes[0];
  const main = dark ? entry.darkMain : entry.main;
  const accent = dark ? entry.darkAccent : entry.accent;
  return (
    <svg className={className} viewBox="0 0 48 48" width={size} height={size}
      role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <path fill={main} d="M 6.9,41.3 C 9.4,30.2 14.4,21.0 22.2,15.0 C 29.0,9.8 36.2,7.0 42.0,6.0 C 39.8,14.4 35.6,22.4 29.2,29.6 C 22.8,36.5 14.8,40.6 6.9,41.3 Z" />
      <path fill={accent} d="M 10.6,43.0 C 24.7,39.6 38.5,29.1 42.0,6.0 C 46.2,19.7 41.9,34.7 28.6,40.2 C 22.5,42.6 16.8,43.0 10.6,43.0 Z" />
    </svg>
  );
}

// Example persistence in the app's existing local settings:
// logoPalette: GlossleafPaletteId — default "ink-vermilion"
// Render using <GlossleafMark palette={settings.logoPalette} dark={theme === "dark"} />
