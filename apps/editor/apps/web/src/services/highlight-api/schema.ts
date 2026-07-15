import { z } from "zod";

/**
 * Shared zod schemas for the AI Highlight Clip backend contract, used by
 * both the mock Next.js route handlers (src/app/api/videos, src/app/api/clips)
 * and the client fetch functions (./client.ts). See INTEGRATION_CONTRACT.md
 * and apps/editor/ARCHITECTURE_NOTES.md for the field-level provenance.
 */

export const shotBoundarySchema = z.object({
	start: z.number(),
	end: z.number(),
	confidence: z.number(),
});
export type ShotBoundary = z.infer<typeof shotBoundarySchema>;

export const videoSchema = z.object({
	id: z.string(),
	title: z.string(),
	videoUrl: z.string(),
	mediaAssetId: z.string(),
	durationSeconds: z.number(),
	createdAt: z.string(),
});
export type Video = z.infer<typeof videoSchema>;

export const renderStatusValueSchema = z.enum([
	"idle",
	"queued",
	"rendering",
	"ready",
	"failed",
]);
export type RenderStatusValue = z.infer<typeof renderStatusValueSchema>;

export const clipSchema = z.object({
	id: z.string(),
	videoId: z.string(),
	// Each clip owns its own already-cut footage (see fixtures.ts) rather
	// than sharing one long source VOD — the real ~96-minute langlive VOD
	// isn't available in this repo, only per-clip renders/stand-ins are.
	// start/end are trim offsets (seconds) into THIS clip's own footage,
	// not into a shared timeline.
	sourceVideoUrl: z.string(),
	start: z.number(),
	end: z.number(),
	shots: z.array(shotBoundarySchema),
	score: z.number(),
	category: z.string(),
	mood: z.string(),
	hook: z.string(),
	hookEn: z.string(),
	caption: z.string(),
	captionEn: z.string(),
	hashtags: z.array(z.string()),
	thumbKey: z.string().nullable(),
	renderStatus: renderStatusValueSchema,
	previewUrl: z.string().nullable(),
});
export type Clip = z.infer<typeof clipSchema>;

export const clipPatchSchema = z.object({
	start: z.number().optional(),
	end: z.number().optional(),
	hook: z.string().max(12).optional(),
	hookEn: z.string().optional(),
	caption: z.string().optional(),
	captionEn: z.string().optional(),
	hashtags: z.array(z.string()).optional(),
});
export type ClipPatch = z.infer<typeof clipPatchSchema>;

export const videoClipsResponseSchema = z.object({
	clips: z.array(clipSchema),
});
export type VideoClipsResponse = z.infer<typeof videoClipsResponseSchema>;

export const renderStatusResponseSchema = z.object({
	status: renderStatusValueSchema,
	previewUrl: z.string().nullable(),
});
export type RenderStatusResponse = z.infer<typeof renderStatusResponseSchema>;

/**
 * AI prompt/chat-driven auto-edit. Mirrors docs/contracts/edl.schema.json
 * (the real, teammate-authored EDL contract) rather than an ad-hoc shape —
 * the LLM (or the mock generator standing in for it, see ai-edit-mock.ts)
 * never touches the timeline directly; it returns an Edl, which the client
 * maps onto existing OpenCut Command classes (remote-clips-manager.ts's
 * applyEditPlan). That's the safety boundary: an "AI edit" can only ever be
 * a value matching this schema, never arbitrary code or state.
 *
 * Deviations from the real contract, both scoped to what's demoable here:
 * - `effects[]`/`musicBed` are explicitly "illustrative/fast-follow" in the
 *   real schema too (no effects-library/music-library manifest exists yet)
 *   — the mock generator uses effects[] for the "more reactions" punch-in
 *   zoom, consistent with that framing.
 * - `segments[].crop` is accepted but not applied by the client yet (no
 *   crop-window UI exists in the editor today — see ARCHITECTURE_NOTES.md's
 *   cropWindow gap); segments are otherwise fully applied (source/timeline
 *   in/out points, implicit speed via source-vs-timeline span mismatch).
 */
export const aiEditChipActionSchema = z.enum([
	"reorder",
	"faster_pacing",
	"swap_intro",
	"more_reactions",
]);
export type AiEditChipAction = z.infer<typeof aiEditChipActionSchema>;

export const aiEditChatMessageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});
export type AiEditChatMessage = z.infer<typeof aiEditChatMessageSchema>;

const edlSegmentSchema = z.object({
	segmentId: z.string(),
	clipId: z.string(),
	sourceStart: z.number(),
	sourceEnd: z.number(),
	timelineStart: z.number(),
	timelineEnd: z.number(),
	transitionIn: z
		.object({
			type: z.enum(["cut", "crossfade", "whip_pan"]),
			duration: z.number(),
		})
		.nullable()
		.optional(),
	crop: z
		.object({
			mode: z.enum(["face_track", "center"]),
			cx: z.number().min(0).max(1).optional(),
		})
		.optional(),
});
export type EdlSegment = z.infer<typeof edlSegmentSchema>;

const edlEffectSchema = z.object({
	effectId: z.string(),
	type: z.enum(["sound", "visual"]),
	at: z.number(),
	duration: z.number(),
	params: z.record(z.string(), z.unknown()).optional(),
});
export type EdlEffect = z.infer<typeof edlEffectSchema>;

const edlCaptionOverlaySchema = z.object({
	start: z.number(),
	end: z.number(),
	text: z.string(),
	speaker: z.string().optional(),
});

const edlCaptionsSchema = z.object({
	source: z.literal("transcribe_word_timeline"),
	burnIn: z.boolean(),
	style: z
		.object({
			fontName: z.string().optional(),
			fontSize: z.number().optional(),
			alignment: z.number().optional(),
			marginV: z.number().optional(),
		})
		.optional(),
	overlays: z.array(edlCaptionOverlaySchema),
});

const edlHookOverlaySchema = z.object({
	text: z.string(),
	start: z.number(),
	duration: z.number(),
	style: z.record(z.string(), z.unknown()).optional(),
});

export const edlSchema = z.object({
	edlId: z.string(),
	jobId: z.string(),
	clipIds: z.array(z.string()),
	status: z.enum(["draft", "approved", "rendered"]),
	canvas: z.object({
		width: z.number(),
		height: z.number(),
		fps: z.number(),
	}),
	segments: z.array(edlSegmentSchema),
	effects: z.array(edlEffectSchema).optional(),
	captions: edlCaptionsSchema,
	hookOverlay: edlHookOverlaySchema.nullable().optional(),
	musicBed: z
		.object({
			trackId: z.string(),
			mood: z.string().optional(),
			gainDb: z.number().optional(),
			startOffset: z.number().optional(),
		})
		.nullable()
		.optional(),
});
export type Edl = z.infer<typeof edlSchema>;

export const aiEditRequestSchema = z.object({
	prompt: z.string().max(1000).optional(),
	chipAction: aiEditChipActionSchema.optional(),
	// Prior turns, sent statelessly by the client each request — there's no
	// server-side conversation store, so the caller always resends the full
	// (capped) transcript.
	history: z.array(aiEditChatMessageSchema).max(20).optional(),
	// The last-applied-or-proposed Edl, so follow-up prompts ("now also speed
	// it up") build on the previous turn instead of resetting to the raw clip.
	baselineEdl: edlSchema.optional(),
});
export type AiEditRequest = z.infer<typeof aiEditRequestSchema>;

export const aiEditResponseSchema = z.object({
	summary: z.string(),
	edl: edlSchema,
});
export type AiEditResponse = z.infer<typeof aiEditResponseSchema>;
