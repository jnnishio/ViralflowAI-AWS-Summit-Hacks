"use client";

import { useState } from "react";
import { Captions, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";

/**
 * One-click Auto Caption (TikTok / karaoke style).
 *
 * Highlight clips ship RAW (see remote-clips-manager.ts / pipeline/render.py) —
 * no captions are baked in, so the creator keeps full editing control. Pressing
 * this burns karaoke captions onto the active clip SERVER-SIDE, reusing the
 * pipeline's word-level Transcribe timings (pipeline/caption_burn.py), and
 * swaps the clip's footage for the captioned result. Applied once per clip;
 * switching clips re-arms it. Skip it on clips where captions aren't wanted
 * (e.g. singing, where Transcribe struggles).
 */
export function AutoCaptionButton() {
	const editor = useEditor();
	const activeClipId = useEditor(
		(e) => e.scenes.getActiveSceneOrNull()?.id ?? null,
	);
	const [isRunning, setIsRunning] = useState(false);
	const [captionedClipIds, setCaptionedClipIds] = useState<Set<string>>(
		new Set(),
	);

	const captioned = activeClipId ? captionedClipIds.has(activeClipId) : false;
	const disabled = !activeClipId || isRunning || captioned;

	const runAutoCaption = async () => {
		if (!activeClipId) return;
		setIsRunning(true);
		try {
			await editor.remoteClips.applyServerCaptions({ clipId: activeClipId });
			setCaptionedClipIds((prev) => new Set(prev).add(activeClipId));
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

	return (
		<button
			type="button"
			onClick={runAutoCaption}
			disabled={disabled}
			title="Burn TikTok-style karaoke captions onto this clip"
			className={cn(
				"flex items-center gap-1.5 rounded-[0.6rem] px-3.5 py-1 text-[0.875rem] font-medium text-white transition-all",
				"bg-linear-270 from-[#0EA5E9] to-[#6366F1] shadow-[0_1px_3px_0px_rgba(0,0,0,0.55)]",
				"hover:brightness-110 disabled:cursor-not-allowed",
				captioned ? "opacity-70" : "disabled:opacity-50",
			)}
		>
			{isRunning ? (
				<Loader2 className="size-3.5 animate-spin" />
			) : captioned ? (
				<Check className="size-3.5" />
			) : (
				<Captions className="size-3.5" />
			)}
			<span>
				{isRunning
					? "Captioning…"
					: captioned
						? "Captioned"
						: "Auto Caption"}
			</span>
		</button>
	);
}
