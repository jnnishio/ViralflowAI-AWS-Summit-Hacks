import type { AiEditRequest, AiEditResponse, Clip, Edl, EdlSegment } from "./schema";

/**
 * Deterministic stand-in for a real Bedrock call producing an EDL (see
 * docs/contracts/edl.schema.json for the real contract this returns, and
 * pipeline/director.py for the real prompt/response pattern this mirrors —
 * "reply with ONLY a JSON object", strict schema, no freeform mutation).
 * Used when AWS Bedrock credentials aren't configured in the server
 * environment (src/app/api/clips/[clip_id]/ai-edit/route.ts tries real
 * Bedrock first and falls back to this) — keeps the full request → review →
 * apply UX loop demoable without AWS access.
 */
export function generateMockAiEditResponse({
	clip,
	request,
}: {
	clip: Clip;
	request: AiEditRequest;
}): AiEditResponse {
	const base = buildBaseEdl({ clip });

	if (request.chipAction) {
		return generateForChip({ clip, base, chipAction: request.chipAction });
	}
	return generateForPrompt({ clip, base, prompt: request.prompt ?? "" });
}

export function buildBaseEdl({ clip }: { clip: Clip }): Edl {
	const duration = clip.end - clip.start;

	return {
		edlId: `edl_${clip.id}_${Date.now()}`,
		jobId: clip.videoId,
		clipIds: [clip.id],
		status: "draft",
		canvas: { width: 1080, height: 1920, fps: 30 },
		segments: [
			{
				segmentId: "seg_01",
				clipId: clip.id,
				sourceStart: clip.start,
				sourceEnd: clip.end,
				timelineStart: 0,
				timelineEnd: duration,
				transitionIn: null,
				crop: { mode: "center" },
			},
		],
		effects: [],
		captions: {
			source: "transcribe_word_timeline",
			burnIn: true,
			style: { fontName: "PingFang TC", fontSize: 64, alignment: 2, marginV: 220 },
			overlays: [],
		},
		hookOverlay: { text: clip.hook, start: 0, duration: 2.5 },
		musicBed: null,
	};
}

function generateForChip({
	clip,
	base,
	chipAction,
}: {
	clip: Clip;
	base: Edl;
	chipAction: NonNullable<AiEditRequest["chipAction"]>;
}): AiEditResponse {
	switch (chipAction) {
		case "faster_pacing":
			return {
				summary: "Sped up the clip by 30% for punchier pacing.",
				edl: withSpeed({ base, rate: 1.3 }),
			};

		case "reorder":
			return buildReorderResponse({ clip, base });

		case "swap_intro":
			return {
				summary:
					"Swap intro isn't available yet — this clip has no alternate footage to draw from.",
				edl: base,
			};

		case "more_reactions":
			return buildEmphasisResponse({ clip, base });
	}
}

function withSpeed({ base, rate }: { base: Edl; rate: number }): Edl {
	const segment = base.segments[0];
	const sourceSpan = segment.sourceEnd - segment.sourceStart;
	return {
		...base,
		segments: [{ ...segment, timelineStart: 0, timelineEnd: sourceSpan / rate }],
	};
}

function buildReorderResponse({ clip, base }: { clip: Clip; base: Edl }): AiEditResponse {
	if (clip.shots.length < 2) {
		return {
			summary: "Not enough distinct segments in this clip to reorder.",
			edl: base,
		};
	}

	// Deterministic placeholder strategy: lead with the last shot (often the
	// payoff/punchline in a highlight clip), then play the rest in order.
	const shotOrder = [
		clip.shots.length - 1,
		...clip.shots.slice(0, -1).map((_, i) => i),
	];

	let timelineCursor = 0;
	const segments: EdlSegment[] = shotOrder.map((shotIndex, position) => {
		const shot = clip.shots[shotIndex];
		const span = shot.end - shot.start;
		const segment: EdlSegment = {
			segmentId: `seg_${String(position + 1).padStart(2, "0")}`,
			clipId: clip.id,
			sourceStart: shot.start,
			sourceEnd: shot.end,
			timelineStart: timelineCursor,
			timelineEnd: timelineCursor + span,
			transitionIn: position === 0 ? null : { type: "cut", duration: 0 },
			crop: { mode: "center" },
		};
		timelineCursor += span;
		return segment;
	});

	return {
		summary: "Reordered segments to lead with the clip's final beat.",
		edl: { ...base, segments },
	};
}

function buildEmphasisResponse({ clip, base }: { clip: Clip; base: Edl }): AiEditResponse {
	const mid = (clip.end - clip.start) / 2;
	return {
		summary:
			"Added a punch-in zoom around the clip's midpoint to emphasize the reaction.",
		edl: {
			...base,
			effects: [
				{
					effectId: "punch-in-zoom",
					type: "visual",
					at: Math.max(0, mid - 1),
					duration: 2,
					params: { scale: 1.3 },
				},
			],
		},
	};
}

function generateForPrompt({
	clip,
	base,
	prompt,
}: {
	clip: Clip;
	base: Edl;
	prompt: string;
}): AiEditResponse {
	const lower = prompt.toLowerCase();

	if (/short|trim|cut|tighter/.test(lower)) {
		const segment = base.segments[0];
		const span = segment.sourceEnd - segment.sourceStart;
		const tightened = span * 0.2;
		const sourceStart = segment.sourceStart + tightened;
		const sourceEnd = segment.sourceEnd - tightened;
		return {
			summary: `Trimmed ${tightened.toFixed(1)}s off each end for a tighter cut.`,
			edl: {
				...base,
				segments: [
					{ ...segment, sourceStart, sourceEnd, timelineEnd: sourceEnd - sourceStart },
				],
			},
		};
	}

	if (/fast|speed|pace|quicker/.test(lower)) {
		return generateForChip({ clip, base, chipAction: "faster_pacing" });
	}

	if (/zoom|reaction|emphasis|punch/.test(lower)) {
		return buildEmphasisResponse({ clip, base });
	}

	if (/caption|subtitle|text/.test(lower)) {
		return {
			summary: "Added the hook as an on-screen caption for the first 2.5 seconds.",
			edl: {
				...base,
				captions: {
					...base.captions,
					overlays: [{ start: 0, end: 2.5, text: clip.hook }],
				},
			},
		};
	}

	if (/reorder|rearrange|order/.test(lower)) {
		return buildReorderResponse({ clip, base });
	}

	return {
		summary:
			"Couldn't determine a specific edit from that prompt — try a quick action, or mention trim/speed/captions/zoom/reorder directly.",
		edl: base,
	};
}
