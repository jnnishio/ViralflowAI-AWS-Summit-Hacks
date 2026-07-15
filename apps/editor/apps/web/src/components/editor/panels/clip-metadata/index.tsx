"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
	AiEditChipAction,
	AiEditResponse,
	RenderStatusValue,
} from "@/services/highlight-api/schema";

const HOOK_MAX_LENGTH = 12;

const AI_EDIT_CHIPS: { action: AiEditChipAction; label: string }[] = [
	{ action: "reorder", label: "Reorder" },
	{ action: "faster_pacing", label: "Faster pacing" },
	{ action: "swap_intro", label: "Swap intro" },
	{ action: "more_reactions", label: "More reactions" },
];

/**
 * Clip-level metadata panel: hook/caption/hashtags in 中文 + English for the
 * currently active scene (== the currently open highlight clip, see
 * core/managers/remote-clips-manager.ts). Sibling to PropertiesPanel rather
 * than a tab within it, since this is scene-level metadata, not per-element.
 */
export function ClipMetadataPanel() {
	const editor = useEditor();
	const activeSceneId = useEditor(
		(e) => e.scenes.getActiveSceneOrNull()?.id ?? null,
	);
	const clip = useEditor((e) =>
		activeSceneId ? e.remoteClips.getClip({ clipId: activeSceneId }) : null,
	);

	const [hook, setHook] = useState("");
	const [hookEn, setHookEn] = useState("");
	const [caption, setCaption] = useState("");
	const [captionEn, setCaptionEn] = useState("");
	const [hashtagsText, setHashtagsText] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	const [aiPrompt, setAiPrompt] = useState("");
	const [aiStatus, setAiStatus] = useState<"idle" | "thinking" | "review">("idle");
	const [aiResponse, setAiResponse] = useState<AiEditResponse | null>(null);

	useEffect(() => {
		if (!clip) return;
		setHook(clip.hook);
		setHookEn(clip.hookEn);
		setCaption(clip.caption);
		setCaptionEn(clip.captionEn);
		setHashtagsText(clip.hashtags.join(", "));
	}, [clip?.id]);

	if (!activeSceneId || !clip) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<p className="text-muted-foreground text-sm">No clip selected</p>
			</div>
		);
	}

	const hashtags = hashtagsText
		.split(",")
		.map((tag) => tag.trim())
		.filter(Boolean);

	const handleFieldBlur = () => {
		editor.remoteClips.updateClipMetadataDraft({
			clipId: clip.id,
			patch: { hook, hookEn, caption, captionEn, hashtags },
		});
	};

	const requestAiEdit = async (request: { prompt?: string; chipAction?: AiEditChipAction }) => {
		setAiStatus("thinking");
		setAiResponse(null);
		try {
			const response = await editor.remoteClips.requestAiEdit({
				clipId: clip.id,
				request,
			});
			setAiResponse(response);
			setAiStatus("review");
		} catch (error) {
			setAiStatus("idle");
			toast.error("AI edit request failed", {
				description: error instanceof Error ? error.message : "Please try again",
			});
		}
	};

	const handleApplyAiEdit = () => {
		if (!aiResponse) return;
		editor.remoteClips.applyEdl({ edl: aiResponse.edl });
		toast.success("AI edit applied — Ctrl+Z to undo");
		setAiStatus("idle");
		setAiResponse(null);
		setAiPrompt("");
	};

	const handleDiscardAiEdit = () => {
		setAiStatus("idle");
		setAiResponse(null);
	};

	const handleSaveAndRender = async () => {
		editor.remoteClips.updateClipMetadataDraft({
			clipId: clip.id,
			patch: { hook, hookEn, caption, captionEn, hashtags },
		});

		setIsSaving(true);
		try {
			await editor.remoteClips.saveAndRender({ clipId: clip.id });
		} catch (error) {
			toast.error("Failed to save & render clip", {
				description: error instanceof Error ? error.message : "Please try again",
			});
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="flex flex-col gap-4 p-3">
				<div className="flex flex-col gap-1">
					<div className="flex items-center justify-between">
						<label className="text-xs text-muted-foreground">Hook (中文)</label>
						<span
							className={
								hook.length > HOOK_MAX_LENGTH
									? "text-xs text-destructive"
									: "text-xs text-muted-foreground"
							}
						>
							{hook.length}/{HOOK_MAX_LENGTH}
						</span>
					</div>
					<Input value={hook} onChange={(e) => setHook(e.target.value)} onBlur={handleFieldBlur} />
				</div>

				<div className="flex flex-col gap-1">
					<label className="text-xs text-muted-foreground">Hook (English)</label>
					<Input value={hookEn} onChange={(e) => setHookEn(e.target.value)} onBlur={handleFieldBlur} />
				</div>

				<div className="flex flex-col gap-1">
					<label className="text-xs text-muted-foreground">Caption (中文)</label>
					<Textarea
						value={caption}
						onChange={(e) => setCaption(e.target.value)}
						onBlur={handleFieldBlur}
						rows={3}
					/>
				</div>

				<div className="flex flex-col gap-1">
					<label className="text-xs text-muted-foreground">Caption (English)</label>
					<Textarea
						value={captionEn}
						onChange={(e) => setCaptionEn(e.target.value)}
						onBlur={handleFieldBlur}
						rows={3}
					/>
				</div>

				<div className="flex flex-col gap-1">
					<label className="text-xs text-muted-foreground">
						Hashtags (comma-separated)
					</label>
					<Textarea
						value={hashtagsText}
						onChange={(e) => setHashtagsText(e.target.value)}
						onBlur={handleFieldBlur}
						rows={2}
					/>
					<div className="flex flex-wrap gap-1 pt-1">
						{hashtags.map((tag) => (
							<Badge key={tag} variant="secondary">
								{tag}
							</Badge>
						))}
					</div>
				</div>

				<div className="flex flex-col gap-2 border-t pt-3">
					<label className="text-xs text-muted-foreground">AI Edit</label>
					<div className="flex flex-wrap gap-1">
						{AI_EDIT_CHIPS.map((chip) => (
							<Button
								key={chip.action}
								variant="outline"
								size="sm"
								disabled={aiStatus === "thinking"}
								onClick={() => requestAiEdit({ chipAction: chip.action })}
							>
								{chip.label}
							</Button>
						))}
					</div>
					<Textarea
						placeholder="Or describe what you want changed..."
						value={aiPrompt}
						onChange={(e) => setAiPrompt(e.target.value)}
						rows={2}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={aiStatus === "thinking" || !aiPrompt.trim()}
						onClick={() => requestAiEdit({ prompt: aiPrompt })}
					>
						{aiStatus === "thinking" ? "Thinking..." : "Ask AI"}
					</Button>

					{aiStatus === "review" && aiResponse && (
						<div className="flex flex-col gap-2 rounded-md bg-accent/50 p-2">
							<p className="text-xs">{aiResponse.summary}</p>
							<div className="flex gap-2">
								<Button size="sm" className="flex-1" onClick={handleApplyAiEdit}>
									Apply
								</Button>
								<Button
									size="sm"
									variant="outline"
									className="flex-1"
									onClick={handleDiscardAiEdit}
								>
									Discard
								</Button>
							</div>
						</div>
					)}
				</div>

				<div className="flex flex-col gap-2 pt-2">
					<Button onClick={handleSaveAndRender} disabled={isSaving} className="w-full">
						{isSaving ? "Saving..." : "Save & Render"}
					</Button>
					<RenderStatusLabel status={clip.renderStatus} />
				</div>

				{clip.renderStatus === "ready" && clip.previewUrl && (
					<div className="flex flex-col gap-1">
						<label className="text-xs text-muted-foreground">
							Cloud render preview
						</label>
						{/* biome-ignore lint/a11y/useMediaCaption: mock render output, no captions to attach */}
						<video src={clip.previewUrl} controls className="w-full rounded-md" />
					</div>
				)}
			</div>
		</ScrollArea>
	);
}

function RenderStatusLabel({ status }: { status: RenderStatusValue }) {
	if (status === "idle") return null;

	const labels: Record<RenderStatusValue, string> = {
		idle: "",
		queued: "Queued...",
		rendering: "Rendering...",
		ready: "Render ready",
		failed: "Render failed",
	};

	return (
		<p
			className={
				status === "failed"
					? "text-xs text-destructive text-center"
					: "text-xs text-muted-foreground text-center"
			}
		>
			{labels[status]}
		</p>
	);
}
