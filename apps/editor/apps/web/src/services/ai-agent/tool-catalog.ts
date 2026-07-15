/**
 * Shared tool catalog for the autonomous editing agent. Each tool maps
 * directly to an existing `TimelineManager` method (see tool-executor.ts),
 * so every call already goes through the standard Command/undo system —
 * Ctrl+Z always reverts an agent step exactly like a human action.
 *
 * v1 scope, deliberately: trim/retime/split/move/delete/duplicate, tracks,
 * text overlays, the one registered effect (blur), and mute/visibility
 * toggles. Deferred (fast-follow, not withheld — same "illustrative"
 * framing as schema.ts's effects[]/musicBed): masks/crop, keyframe
 * animation, sound-library insertion, multi-scene ops, project settings.
 * Transitions/color-adjustment aren't available to a human either (both
 * are "coming soon" placeholder panels in this codebase).
 *
 * This is consumed two ways: the server (agent-turn/route.ts) turns it
 * into Bedrock's `toolConfig`; the client (tool-executor.ts) dispatches on
 * `name` to the matching editor call. Keep both in sync with this list.
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: JsonSchema;
}

const elementRef: JsonSchema = {
	type: "object",
	properties: {
		trackId: { type: "string" },
		elementId: { type: "string" },
	},
	required: ["trackId", "elementId"],
};

const elementRefList: JsonSchema = {
	type: "array",
	items: elementRef,
	minItems: 1,
};

export const AGENT_TOOLS: ToolDefinition[] = [
	{
		name: "trim_element",
		description:
			"Set the source trim window for a video/image element (seconds into its own media). The element's timeline duration follows the trim span 1:1 unless durationSeconds is given.",
		inputSchema: {
			type: "object",
			properties: {
				elementId: { type: "string" },
				trimStartSeconds: { type: "number" },
				trimEndSeconds: { type: "number" },
				startTimeSeconds: {
					type: "number",
					description: "Optional new timeline position (seconds). Omit to keep the current position.",
				},
				durationSeconds: {
					type: "number",
					description: "Optional new timeline duration (seconds). Omit to match the new trim span.",
				},
			},
			required: ["elementId", "trimStartSeconds", "trimEndSeconds"],
		},
	},
	{
		name: "retime_element",
		description: "Change an element's playback speed (e.g. rate 1.3 = 30% faster). rate 1.0 removes retiming.",
		inputSchema: {
			type: "object",
			properties: {
				trackId: { type: "string" },
				elementId: { type: "string" },
				rate: { type: "number", minimum: 0.1, maximum: 8 },
				maintainPitch: { type: "boolean" },
			},
			required: ["trackId", "elementId", "rate"],
		},
	},
	{
		name: "split_element",
		description: "Split an element into two at a timeline moment.",
		inputSchema: {
			type: "object",
			properties: {
				trackId: { type: "string" },
				elementId: { type: "string" },
				splitTimeSeconds: { type: "number" },
				retainSide: { type: "string", enum: ["both", "left", "right"] },
			},
			required: ["trackId", "elementId", "splitTimeSeconds"],
		},
	},
	{
		name: "move_element",
		description: "Move an element to a new timeline position, optionally onto a different track (for reordering).",
		inputSchema: {
			type: "object",
			properties: {
				trackId: { type: "string", description: "The element's current track." },
				elementId: { type: "string" },
				targetTrackId: {
					type: "string",
					description: "Destination track. Omit to keep the element on its current track.",
				},
				newStartTimeSeconds: { type: "number" },
			},
			required: ["trackId", "elementId", "newStartTimeSeconds"],
		},
	},
	{
		name: "delete_elements",
		description: "Delete one or more elements.",
		inputSchema: {
			type: "object",
			properties: { elements: elementRefList },
			required: ["elements"],
		},
	},
	{
		name: "duplicate_elements",
		description: "Duplicate one or more elements onto new tracks above their source.",
		inputSchema: {
			type: "object",
			properties: { elements: elementRefList },
			required: ["elements"],
		},
	},
	{
		name: "add_track",
		description: "Add a new empty track of the given type.",
		inputSchema: {
			type: "object",
			properties: {
				type: { type: "string", enum: ["video", "text", "audio", "graphic", "effect"] },
				index: { type: "number", description: "Optional display index. Omit to append." },
			},
			required: ["type"],
		},
	},
	{
		name: "insert_text_element",
		description:
			"Insert an on-screen text element (caption, hook, title). Use for any request to add/change on-screen text.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string" },
				startTimeSeconds: { type: "number" },
				durationSeconds: { type: "number" },
				fontSize: { type: "number" },
				textAlign: { type: "string", enum: ["left", "center", "right"] },
				trackId: {
					type: "string",
					description: "Optional existing text track to insert onto. Omit to auto-place (creating a text track if needed).",
				},
			},
			required: ["content", "startTimeSeconds", "durationSeconds"],
		},
	},
	{
		name: "add_blur_effect",
		description: "Add a blur effect to an element (the only effect type currently available, same as a human has in the Effects panel).",
		inputSchema: {
			type: "object",
			properties: {
				trackId: { type: "string" },
				elementId: { type: "string" },
			},
			required: ["trackId", "elementId"],
		},
	},
	{
		name: "remove_clip_effect",
		description: "Remove a previously added effect from an element.",
		inputSchema: {
			type: "object",
			properties: {
				trackId: { type: "string" },
				elementId: { type: "string" },
				effectId: { type: "string" },
			},
			required: ["trackId", "elementId", "effectId"],
		},
	},
	{
		name: "toggle_clip_effect",
		description: "Enable/disable an element's effect without removing it.",
		inputSchema: {
			type: "object",
			properties: {
				trackId: { type: "string" },
				elementId: { type: "string" },
				effectId: { type: "string" },
			},
			required: ["trackId", "elementId", "effectId"],
		},
	},
	{
		name: "toggle_track_mute",
		description: "Toggle mute on an audio-capable track.",
		inputSchema: {
			type: "object",
			properties: { trackId: { type: "string" } },
			required: ["trackId"],
		},
	},
	{
		name: "toggle_track_visibility",
		description: "Toggle hide/show on a visual track.",
		inputSchema: {
			type: "object",
			properties: { trackId: { type: "string" } },
			required: ["trackId"],
		},
	},
	{
		name: "toggle_elements_muted",
		description: "Toggle mute on one or more elements.",
		inputSchema: {
			type: "object",
			properties: { elements: elementRefList },
			required: ["elements"],
		},
	},
	{
		name: "toggle_elements_visibility",
		description: "Toggle hide/show on one or more elements.",
		inputSchema: {
			type: "object",
			properties: { elements: elementRefList },
			required: ["elements"],
		},
	},
];
