/**
 * "Pattern craft" gradient backgrounds for the editor's background picker.
 * Each entry is a CSS `background` value (applied directly via inline style in
 * background.tsx). See solid.ts for why this file was missing from the repo.
 */
export const patternCraftGradients: readonly string[] = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #30cfd0 0%, #330867 100%)",
  "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
  "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)",
  "linear-gradient(to right, #6a11cb 0%, #2575fc 100%)",
  "linear-gradient(to right, #ff512f 0%, #dd2476 100%)",
  "linear-gradient(to right, #1a2980 0%, #26d0ce 100%)",
  "radial-gradient(circle at 50% 0%, #3b82f6 0%, #0f172a 75%)",
] as const
