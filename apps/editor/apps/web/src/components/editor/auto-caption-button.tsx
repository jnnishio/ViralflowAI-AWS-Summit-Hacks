"use client";

import { useState } from "react";
import { Captions, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";

/**
 * One-click Auto Caption (TikTok / karaoke style), toggleable.
 *
 * Highlight clips ship RAW (see remote-clips-manager.ts / pipeline/render.py) —
 * no captions are baked in, so the creator keeps full editing control. Pressing
 * this burns karaoke captions onto the active clip SERVER-SIDE, reusing the
 * pipeline's word-level Transcribe timings (pipeline/caption_burn.py), and
 * swaps the clip's footage for the captioned result.
 *
 * Once applied, the button becomes an undo toggle: it reads "Auto-Captioned"
 * and, on hover, "Undo" — clicking swaps the footage back to the raw clip.
 * State is per clip; switching clips reflects that clip's own caption state.
 */
export function AutoCaptionButton() {
	const editor = useEditor();
	const activeClipId = useEditor(
		(e) => e.scenes.getActiveSceneOrNull()?.id ?? null,
	);
	const [isRunning, setIsRunning] = useState(false);
	const [isHovering, setIsHovering] = useState(false);
	const [captionedClipIds, setCaptionedClipIds] = useState<Set<string>>(
		new Set(),
	);

	const captioned = activeClipId ? captionedClipIds.has(activeClipId) : false;
	// Clickable while captioned (to undo); only blocked with no clip or mid-run.
	const disabled = !activeClipId || isRunning;

	const applyCaptions = async (clipId: string) => {
		setIsRunning(true);
		try {
			await editor.remoteClips.applyServerCaptions({ clipId });
			setCaptionedClipIds((prev) => new Set(prev).add(clipId));
			toast.success("Captions applied", {
				description: "Karaoke captions burned onto this clip.",
			});
		} catch (error) {
			toast.error("Auto Caption failed", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
		} finally {
			setIsRunning(false);
		}
	};

	const undoCaptions = (clipId: string) => {
		try {
			editor.remoteClips.removeServerCaptions({ clipId });
			setCaptionedClipIds((prev) => {
				const next = new Set(prev);
				next.delete(clipId);
				return next;
			});
			toast.success("Captions removed", {
				description: "Reverted to the raw clip.",
			});
		} catch (error) {
			toast.error("Couldn't remove captions", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
		}
	};

	const handleClick = () => {
		if (!activeClipId || isRunning) return;
		if (captioned) {
			undoCaptions(activeClipId);
		} else {
			void applyCaptions(activeClipId);
		}
	};

	const label = isRunning
		? "Captioning…"
		: captioned
			? isHovering
				? "Undo"
				: "Auto-Captioned"
			: "Auto Caption";

	return (
		<button
			type="button"
			onClick={handleClick}
			onMouseEnter={() => setIsHovering(true)}
			onMouseLeave={() => setIsHovering(false)}
			disabled={disabled}
			title={
				captioned
					? "Remove the burned-in captions from this clip"
					: "Burn TikTok-style karaoke captions onto this clip"
			}
			className={cn(
				"flex items-center gap-1.5 rounded-[0.6rem] px-3.5 py-1 text-[0.875rem] font-medium text-white transition-all",
				"bg-linear-270 from-[#0EA5E9] to-[#6366F1] shadow-[0_1px_3px_0px_rgba(0,0,0,0.55)]",
				"hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
				captioned && !isHovering && "opacity-70",
			)}
		>
			{isRunning ? (
				<Loader2 className="size-3.5 animate-spin" />
			) : captioned ? (
				<Check className="size-3.5" />
			) : (
				<Captions className="size-3.5" />
			)}
			<span>{label}</span>
		</button>
	);
}
