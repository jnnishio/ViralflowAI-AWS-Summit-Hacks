/**
 * Solid background colors for the editor's background picker
 * (components/editor/panels/assets/views/settings/background.tsx).
 *
 * NOTE: this file lives under src/data/, which the editor's .gitignore
 * previously excluded (a broad `data/` rule), so it was missing from the repo
 * and broke the /editor route. Kept as a plain string[] of hex colors, which
 * is exactly what BackgroundContent consumes.
 */
export const colors: readonly string[] = [
  "#000000",
  "#111827",
  "#1f2937",
  "#374151",
  "#4b5563",
  "#6b7280",
  "#9ca3af",
  "#d1d5db",
  "#f3f4f6",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
] as const
