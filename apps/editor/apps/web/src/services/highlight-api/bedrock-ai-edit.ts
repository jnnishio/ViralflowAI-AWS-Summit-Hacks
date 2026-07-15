import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { aiEditResponseSchema, type AiEditRequest, type Clip, type Edl } from "./schema";

/**
 * Real Bedrock-backed AI edit generation, mirroring pipeline/director.py's
 * pattern (boto3 bedrock-runtime.converse, "reply with ONLY a JSON object",
 * defensive first-`{`-to-last-`}` slice before JSON.parse) but targeting an
 * Edl (edit decision list) for an already-selected clip instead of a
 * highlight-judging verdict. See docs/contracts/edl.schema.json and
 * schema.ts for the contract this must satisfy — that zod parse below is the
 * actual safety boundary, never bypass it.
 */

const REGION = process.env.AWS_REGION ?? "us-east-1";
export const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6";

export class AiEditGenerationError extends Error {}

export function isBedrockConfigured(): boolean {
	return Boolean(process.env.AWS_REGION);
}

let cachedClient: BedrockRuntimeClient | null = null;
/** Shared across every Bedrock-calling route (ai-edit, agent-turn) — one client per server process. */
export function getBedrockClient(): BedrockRuntimeClient {
	if (!cachedClient) {
		cachedClient = new BedrockRuntimeClient({ region: REGION });
	}
	return cachedClient;
}

const SYSTEM = `You are a veteran short-form video editor (TikTok / IG Reels / YouTube Shorts) helping a creator polish ONE already-selected highlight clip so it is dynamic, appealing, and ready to post.

You receive: the clip's metadata, the CURRENT draft Edl already applied to it, the conversation so far, and the user's latest request (a quick-action chip and/or a freeform instruction).

Reply with ONLY a JSON object (no markdown fence, no commentary) matching this shape:
{
  "summary": "...",              // one sentence, plain English, describing what you changed and why
  "edl": {
    "edlId": "...", "jobId": "...", "clipIds": ["..."], "status": "draft",
    "canvas": { "width": 1080, "height": 1920, "fps": 30 },
    "segments": [ { "segmentId": "...", "clipId": "...", "sourceStart": <float>, "sourceEnd": <float>, "timelineStart": <float>, "timelineEnd": <float>, "transitionIn": null | {"type": "cut"|"crossfade"|"whip_pan", "duration": <float>}, "crop": {"mode": "center"|"face_track"} } ],
    "effects": [ { "effectId": "...", "type": "visual"|"sound", "at": <float>, "duration": <float>, "params": {} } ],
    "captions": { "source": "transcribe_word_timeline", "burnIn": true, "style": {"fontName": "PingFang TC", "fontSize": 64, "alignment": 2, "marginV": 220}, "overlays": [ {"start": <float>, "end": <float>, "text": "...", "speaker": "..."} ] },
    "hookOverlay": null | { "text": "...", "start": <float>, "duration": <float>, "style": {} },
    "musicBed": null
  },
  "musicIntent": null | { "mood": "...", "query": "..." }
}

Segment semantics (must follow exactly — this is what the editor applies):
- sourceStart/sourceEnd: the trim window INTO THE CLIP'S OWN FOOTAGE (seconds, 0 = clip start). Never go outside the clip's own duration.
- timelineStart/timelineEnd: where that segment lands in the OUTPUT timeline. Multiple segments with different sourceStart/sourceEnd reorder shots. Implicit speed change = timeline span shorter/longer than source span (e.g. 30% faster means timelineEnd-timelineStart = (sourceEnd-sourceStart)/1.3).
- effects[] type "visual" with params {"scale": <float>} = a punch-in zoom, for reaction/emphasis requests. type "sound" = a stinger/sfx cue.
- captions.overlays and hookOverlay carry ON-SCREEN TEXT, not narration.

STRICT SCOPE RULE — this is the most important rule, follow it even if you think another change would improve the clip:
Only change what the request explicitly asks for. Do NOT add transitions, effects, captions, zooms, crop changes, or any other embellishment that wasn't requested, even as a "nice bonus." If the user asks to speed up the clip, ONLY change segment timing — do not also add whip-pans or punch-in zooms unless they separately asked for emphasis/reactions. Copy every other field from the current draft edl byte-for-byte unchanged.

Quick-action chip definitions (when the request is one of these, do EXACTLY this and nothing more):
- "reorder": rearrange the existing segments/shots into a different sequence. Do not change speed, add effects, or add transitions beyond a plain "cut" between reordered segments.
- "faster_pacing": increase playback speed ~30% via timeline compression only (timelineEnd-timelineStart shorter than sourceEnd-sourceStart). Do not add effects or transitions.
- "swap_intro": only possible if the clip has genuinely distinct alternate footage; this demo clip does not, so say so honestly in "summary" and return the CURRENT draft edl unchanged — do not invent unrelated changes instead.
- "more_reactions": add one or two punch-in zoom effects (effects[] type "visual") at the clip's most expressive moment(s). Do not change segment timing, transitions, or anything else.

- Always return a FULL, valid edl — a complete replacement for the current draft, not a diff. Preserve everything the user didn't ask to change.
- If the request is unclear or not achievable, say so honestly in "summary" and return the CURRENT draft edl unchanged rather than guessing at an unrelated change.
- musicIntent: set this ONLY in direct response to an explicit music/song/soundtrack request — you don't pick the actual track, just describe the mood/style wanted (e.g. "upbeat lo-fi", "tense cinematic"); the server resolves a real track separately. Otherwise null.`;

function buildUserContent({
	clip,
	baselineEdl,
	request,
}: {
	clip: Clip;
	baselineEdl: Edl;
	request: AiEditRequest;
}): string {
	const lines: string[] = [
		`Clip metadata: ${JSON.stringify({
			id: clip.id,
			category: clip.category,
			mood: clip.mood,
			hook: clip.hook,
			caption: clip.caption,
			durationSeconds: clip.end - clip.start,
			shots: clip.shots,
		})}`,
		`Current draft Edl: ${JSON.stringify(baselineEdl)}`,
	];

	if (request.history?.length) {
		lines.push(
			"Conversation so far:\n" +
				request.history.map((turn) => `${turn.role}: ${turn.content}`).join("\n"),
		);
	}

	if (request.chipAction) {
		lines.push(`Latest request (quick action): ${request.chipAction}`);
	}
	if (request.prompt) {
		lines.push(`Latest request (freeform): ${request.prompt}`);
	}

	return lines.join("\n\n");
}

const bedrockAiEditResultSchema = aiEditResponseSchema.extend({
	musicIntent: z
		.object({ mood: z.string(), query: z.string().optional() })
		.nullable()
		.optional(),
});
export type BedrockAiEditResult = z.infer<typeof bedrockAiEditResultSchema>;

/**
 * Extracts the first balanced top-level JSON object from a string, ignoring
 * any trailing prose the model adds despite the system prompt forbidding it
 * (occasionally happens). A naive first-`{`-to-last-`}` slice grabs any
 * stray brace in that trailing text too, producing invalid JSON — this
 * walks brace depth (respecting string literals/escapes) to find the exact
 * matching close instead.
 */
function extractFirstJsonObject(raw: string): string {
	const start = raw.indexOf("{");
	if (start === -1) {
		throw new AiEditGenerationError("Bedrock response contained no JSON object");
	}

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < raw.length; i++) {
		const char = raw[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
		} else if (char === "{") {
			depth++;
		} else if (char === "}") {
			depth--;
			if (depth === 0) {
				return raw.slice(start, i + 1);
			}
		}
	}

	throw new AiEditGenerationError("Bedrock response had an unterminated JSON object");
}

export async function generateBedrockAiEditResponse({
	clip,
	baselineEdl,
	request,
}: {
	clip: Clip;
	baselineEdl: Edl;
	request: AiEditRequest;
}): Promise<BedrockAiEditResult> {
	const content = buildUserContent({ clip, baselineEdl, request });

	const command = new ConverseCommand({
		modelId: MODEL_ID,
		system: [{ text: SYSTEM }],
		messages: [{ role: "user", content: [{ text: content }] }],
		inferenceConfig: { maxTokens: 1500, temperature: 0.2 },
	});

	let raw: string;
	try {
		const resp = await getBedrockClient().send(command);
		const text = resp.output?.message?.content?.[0]?.text;
		if (!text) {
			throw new AiEditGenerationError("Bedrock returned no text content");
		}
		raw = text;
	} catch (error) {
		if (error instanceof AiEditGenerationError) throw error;
		throw new AiEditGenerationError(
			`Bedrock call failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(extractFirstJsonObject(raw));
	} catch (error) {
		throw new AiEditGenerationError(
			`Bedrock response wasn't valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// The model is instructed to always leave edl.musicBed null (the route
	// resolves the real track from musicIntent server-side), but it
	// sometimes fills in a partial object anyway despite that instruction.
	// Normalize rather than trust it, since that field is always overwritten
	// by the route regardless of what's here.
	if (
		parsedJson &&
		typeof parsedJson === "object" &&
		"edl" in parsedJson &&
		parsedJson.edl &&
		typeof parsedJson.edl === "object"
	) {
		(parsedJson.edl as { musicBed?: unknown }).musicBed = null;
	}

	const result = bedrockAiEditResultSchema.safeParse(parsedJson);
	if (!result.success) {
		throw new AiEditGenerationError(
			`Bedrock response didn't match the Edl contract: ${result.error.message}`,
		);
	}
	return result.data;
}
