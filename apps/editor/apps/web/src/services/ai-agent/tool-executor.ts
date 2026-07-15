import { z } from "zod";
import type { EditorCore } from "@/core";
import { mediaTimeFromSeconds } from "@/wasm";
import { buildTextElement } from "@/timeline/element-utils";

/**
 * Client-side dispatch from a tool name (see tool-catalog.ts) to the
 * matching EditorCore call. Every branch here goes through the same
 * TimelineManager methods a human UI action would call, so every effect is
 * a normal undo-able Command — Ctrl+Z reverts one tool call exactly like it
 * would revert a manual edit.
 *
 * Runs entirely in the browser: EditorCore/TimelineManager and the WASM
 * MediaTime helpers only exist client-side (see agent-runner.ts).
 */

const elementRef = z.object({ trackId: z.string(), elementId: z.string() });

const toolInputSchemas = {
	trim_element: z.object({
		elementId: z.string(),
		trimStartSeconds: z.number(),
		trimEndSeconds: z.number(),
		startTimeSeconds: z.number().optional(),
		durationSeconds: z.number().optional(),
	}),
	retime_element: z.object({
		trackId: z.string(),
		elementId: z.string(),
		rate: z.number(),
		maintainPitch: z.boolean().optional(),
	}),
	split_element: z.object({
		trackId: z.string(),
		elementId: z.string(),
		splitTimeSeconds: z.number(),
		retainSide: z.enum(["both", "left", "right"]).optional(),
	}),
	move_element: z.object({
		trackId: z.string(),
		elementId: z.string(),
		targetTrackId: z.string().optional(),
		newStartTimeSeconds: z.number(),
	}),
	delete_elements: z.object({ elements: z.array(elementRef).min(1) }),
	duplicate_elements: z.object({ elements: z.array(elementRef).min(1) }),
	add_track: z.object({
		type: z.enum(["video", "text", "audio", "graphic", "effect"]),
		index: z.number().optional(),
	}),
	insert_text_element: z.object({
		content: z.string(),
		startTimeSeconds: z.number(),
		durationSeconds: z.number(),
		fontSize: z.number().optional(),
		textAlign: z.enum(["left", "center", "right"]).optional(),
		trackId: z.string().optional(),
	}),
	add_blur_effect: z.object({ trackId: z.string(), elementId: z.string() }),
	remove_clip_effect: z.object({ trackId: z.string(), elementId: z.string(), effectId: z.string() }),
	toggle_clip_effect: z.object({ trackId: z.string(), elementId: z.string(), effectId: z.string() }),
	toggle_track_mute: z.object({ trackId: z.string() }),
	toggle_track_visibility: z.object({ trackId: z.string() }),
	toggle_elements_muted: z.object({ elements: z.array(elementRef).min(1) }),
	toggle_elements_visibility: z.object({ elements: z.array(elementRef).min(1) }),
} as const;

export type ToolName = keyof typeof toolInputSchemas;

export interface ToolExecutionResult {
	status: "success" | "error";
	result: unknown;
}

export function executeTool({
	editor,
	name,
	input,
}: {
	editor: EditorCore;
	name: string;
	input: unknown;
}): ToolExecutionResult {
	try {
		if (!isToolName(name)) {
			return { status: "error", result: `Unknown tool "${name}"` };
		}
		return runTool({ editor, name, input });
	} catch (error) {
		return {
			status: "error",
			result: error instanceof Error ? error.message : String(error),
		};
	}
}

function isToolName(name: string): name is ToolName {
	return name in toolInputSchemas;
}

function runTool({
	editor,
	name,
	input,
}: {
	editor: EditorCore;
	name: ToolName;
	input: unknown;
}): ToolExecutionResult {
	const schema = toolInputSchemas[name];
	const parsed = schema.safeParse(input);
	if (!parsed.success) {
		return { status: "error", result: `Invalid input for ${name}: ${parsed.error.message}` };
	}
	const args = parsed.data;

	switch (name) {
		case "trim_element": {
			const a = args as z.infer<(typeof toolInputSchemas)["trim_element"]>;
			const trimStart = mediaTimeFromSeconds({ seconds: a.trimStartSeconds });
			const trimEnd = mediaTimeFromSeconds({ seconds: a.trimEndSeconds });
			editor.timeline.updateElementTrim({
				elementId: a.elementId,
				trimStart,
				trimEnd,
				startTime: a.startTimeSeconds !== undefined ? mediaTimeFromSeconds({ seconds: a.startTimeSeconds }) : undefined,
				duration:
					a.durationSeconds !== undefined
						? mediaTimeFromSeconds({ seconds: a.durationSeconds })
						: mediaTimeFromSeconds({ seconds: a.trimEndSeconds - a.trimStartSeconds }),
			});
			return { status: "success", result: { elementId: a.elementId } };
		}

		case "retime_element": {
			const a = args as z.infer<(typeof toolInputSchemas)["retime_element"]>;
			editor.timeline.updateElementRetime({
				trackId: a.trackId,
				elementId: a.elementId,
				retime: a.rate === 1 ? undefined : { rate: a.rate, maintainPitch: a.maintainPitch },
			});
			return { status: "success", result: { elementId: a.elementId, rate: a.rate } };
		}

		case "split_element": {
			const a = args as z.infer<(typeof toolInputSchemas)["split_element"]>;
			const created = editor.timeline.splitElements({
				elements: [{ trackId: a.trackId, elementId: a.elementId }],
				splitTime: mediaTimeFromSeconds({ seconds: a.splitTimeSeconds }),
				retainSide: a.retainSide ?? "both",
			});
			return { status: "success", result: { created } };
		}

		case "move_element": {
			const a = args as z.infer<(typeof toolInputSchemas)["move_element"]>;
			editor.timeline.moveElements({
				moves: [
					{
						sourceTrackId: a.trackId,
						targetTrackId: a.targetTrackId ?? a.trackId,
						elementId: a.elementId,
						newStartTime: mediaTimeFromSeconds({ seconds: a.newStartTimeSeconds }),
					},
				],
			});
			return { status: "success", result: { elementId: a.elementId } };
		}

		case "delete_elements": {
			const a = args as z.infer<(typeof toolInputSchemas)["delete_elements"]>;
			editor.timeline.deleteElements({ elements: a.elements });
			return { status: "success", result: { deleted: a.elements.length } };
		}

		case "duplicate_elements": {
			const a = args as z.infer<(typeof toolInputSchemas)["duplicate_elements"]>;
			const duplicated = editor.timeline.duplicateElements({ elements: a.elements });
			return { status: "success", result: { duplicated } };
		}

		case "add_track": {
			const a = args as z.infer<(typeof toolInputSchemas)["add_track"]>;
			const trackId = editor.timeline.addTrack({ type: a.type, index: a.index });
			return { status: "success", result: { trackId } };
		}

		case "insert_text_element": {
			const a = args as z.infer<(typeof toolInputSchemas)["insert_text_element"]>;
			const element = buildTextElement({
				raw: {
					name: "AI text",
					duration: mediaTimeFromSeconds({ seconds: a.durationSeconds }),
					params: {
						content: a.content,
						...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
						...(a.textAlign !== undefined ? { textAlign: a.textAlign } : {}),
					},
				},
				startTime: mediaTimeFromSeconds({ seconds: a.startTimeSeconds }),
			});
			editor.timeline.insertElement({
				element,
				placement: a.trackId ? { mode: "explicit", trackId: a.trackId } : { mode: "auto", trackType: "text" },
			});
			return { status: "success", result: { content: a.content } };
		}

		case "add_blur_effect": {
			const a = args as z.infer<(typeof toolInputSchemas)["add_blur_effect"]>;
			const effectId = editor.timeline.addClipEffect({
				trackId: a.trackId,
				elementId: a.elementId,
				effectType: "blur",
			});
			return { status: "success", result: { effectId } };
		}

		case "remove_clip_effect": {
			const a = args as z.infer<(typeof toolInputSchemas)["remove_clip_effect"]>;
			editor.timeline.removeClipEffect(a);
			return { status: "success", result: { effectId: a.effectId } };
		}

		case "toggle_clip_effect": {
			const a = args as z.infer<(typeof toolInputSchemas)["toggle_clip_effect"]>;
			editor.timeline.toggleClipEffect(a);
			return { status: "success", result: { effectId: a.effectId } };
		}

		case "toggle_track_mute": {
			const a = args as z.infer<(typeof toolInputSchemas)["toggle_track_mute"]>;
			editor.timeline.toggleTrackMute({ trackId: a.trackId });
			return { status: "success", result: { trackId: a.trackId } };
		}

		case "toggle_track_visibility": {
			const a = args as z.infer<(typeof toolInputSchemas)["toggle_track_visibility"]>;
			editor.timeline.toggleTrackVisibility({ trackId: a.trackId });
			return { status: "success", result: { trackId: a.trackId } };
		}

		case "toggle_elements_muted": {
			const a = args as z.infer<(typeof toolInputSchemas)["toggle_elements_muted"]>;
			editor.timeline.toggleElementsMuted({ elements: a.elements });
			return { status: "success", result: { count: a.elements.length } };
		}

		case "toggle_elements_visibility": {
			const a = args as z.infer<(typeof toolInputSchemas)["toggle_elements_visibility"]>;
			editor.timeline.toggleElementsVisibility({ elements: a.elements });
			return { status: "success", result: { count: a.elements.length } };
		}
	}
}
