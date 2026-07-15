/**
 * "Syntax UI" gradient backgrounds for the editor's background picker.
 * Each entry is a CSS `background` value (applied directly via inline style in
 * background.tsx). See solid.ts for why this file was missing from the repo.
 */
export const syntaxUIGradients: readonly string[] = [
  "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
  "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
  "linear-gradient(135deg, #0c4a6e 0%, #075985 100%)",
  "linear-gradient(135deg, #14532d 0%, #166534 100%)",
  "linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)",
  "linear-gradient(135deg, #581c87 0%, #6b21a8 100%)",
  "linear-gradient(to bottom right, #020617 0%, #1e293b 50%, #334155 100%)",
  "linear-gradient(to bottom right, #18181b 0%, #27272a 50%, #3f3f46 100%)",
  "conic-gradient(from 180deg at 50% 50%, #1e293b 0deg, #0f172a 180deg, #1e293b 360deg)",
] as const
