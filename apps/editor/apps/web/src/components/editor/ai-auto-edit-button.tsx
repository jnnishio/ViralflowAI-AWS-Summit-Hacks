"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";

/**
 * One-click AI Auto-Edit.
 *
 * Clips open CLEAN (see remote-clips-manager.ts). Pressing this applies the
 * pipeline's precomputed reaction-zooms, onomatopoeia burst captions, and SFX
 * (requestAiEdit chipAction "auto") to the currently open clip's scene as ONE
 * undoable step (ApplyEdlCommand) — the visible "the AI edits it for you"
 * moment. Applies once per clip; switching clips re-arms it.
 */
export function AiAutoEditButton() {
	const editor = useEditor();
	const activeClipId = useEditor(
		(e) => e.scenes.getActiveSceneOrNull()?.id ?? null,
	);
	const [isRunning, setIsRunning] = useState(false);
	const [appliedClipIds, setAppliedClipIds] = useState<Set<string>>(new Set());

	const applied = activeClipId ? appliedClipIds.has(activeClipId) : false;
	const disabled = !activeClipId || isRunning || applied;

	const runAutoEdit = async () => {
		if (!activeClipId) return;
		setIsRunning(true);
		try {
			const { summary, edl } = await editor.remoteClips.requestAiEdit({
				clipId: activeClipId,
				request: { chipAction: "auto" },
			});
			editor.remoteClips.applyEdl({ edl });
			setAppliedClipIds((prev) => new Set(prev).add(activeClipId));
			toast.success("AI Auto-Edit applied", {
				description: `${summary} Press Ctrl+Z to undo.`,
			});
		} catch (error) {
			toast.error("AI Auto-Edit failed", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<button
			type="button"
			onClick={runAutoEdit}
			disabled={disabled}
			title="Apply AI reaction zooms, burst captions & sound effects to this clip"
			className={cn(
				"flex items-center gap-1.5 rounded-[0.6rem] px-3.5 py-1 text-[0.875rem] font-medium text-white transition-all",
				"bg-linear-270 from-[#7C3AED] to-[#DB2777] shadow-[0_1px_3px_0px_rgba(0,0,0,0.55)]",
				"hover:brightness-110 disabled:cursor-not-allowed",
				applied ? "opacity-70" : "disabled:opacity-50",
			)}
		>
			{isRunning ? (
				<Loader2 className="size-3.5 animate-spin" />
			) : applied ? (
				<Check className="size-3.5" />
			) : (
				<Sparkles className="size-3.5" />
			)}
			<span>
				{isRunning
					? "Auto-editing…"
					: applied
						? "Auto-Edited"
						: "AI Auto-Edit"}
			</span>
		</button>
	);
}
