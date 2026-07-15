import { NextResponse } from "next/server";
import { aiEditRequestSchema, type AiEditResponse, type Clip } from "@/services/highlight-api/schema";
import { getClipFixture } from "@/services/highlight-api/fixtures";
import { buildBaseEdl, generateMockAiEditResponse } from "@/services/highlight-api/ai-edit-mock";
import {
	AiEditGenerationError,
	generateBedrockAiEditResponse,
	isBedrockConfigured,
} from "@/services/highlight-api/bedrock-ai-edit";
import { searchMusicBed } from "@/services/highlight-api/freesound";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ clip_id: string }> },
) {
	const { clip_id } = await params;
	const clip = getClipFixture({ clipId: clip_id });
	if (!clip) {
		return NextResponse.json({ error: "Clip not found" }, { status: 404 });
	}

	const body = await request.json().catch(() => ({}));
	const result = aiEditRequestSchema.safeParse(body);
	if (!result.success) {
		return NextResponse.json(
			{ error: "Invalid AI edit request", details: result.error.flatten().fieldErrors },
			{ status: 400 },
		);
	}

	try {
		const response = await getAiEditResponse({ clip, request: result.data });
		return NextResponse.json(response);
	} catch (error) {
		if (error instanceof AiEditGenerationError) {
			return NextResponse.json(
				{ error: "AI edit generation failed", details: error.message },
				{ status: 502 },
			);
		}
		throw error;
	}
}

/**
 * Two-tier by design: real Bedrock when AWS is configured, deterministic
 * mock otherwise (keeps the request → review → apply loop demoable without
 * AWS access — see ai-edit-mock.ts). A real Bedrock failure does NOT fall
 * back to the mock; that would silently hide bugs, so it surfaces as a 502
 * instead (see the try/catch in POST above).
 */
async function getAiEditResponse({
	clip,
	request,
}: Parameters<typeof generateMockAiEditResponse>[0]): Promise<AiEditResponse> {
	if (!isBedrockConfigured()) {
		return generateMockAiEditResponse({ clip, request });
	}

	const baselineEdl = request.baselineEdl ?? buildBaseEdl({ clip });
	const bedrockResult = await generateBedrockAiEditResponse({ clip, baselineEdl, request });

	const musicIntent = bedrockResult.musicIntent;
	if (!musicIntent) {
		const { musicIntent: _musicIntent, ...response } = bedrockResult;
		return response;
	}

	const musicBed = await resolveMusicBed({ clip, mood: musicIntent.mood, query: musicIntent.query });
	return {
		summary:
			musicBed !== undefined
				? bedrockResult.summary
				: `${bedrockResult.summary} (Couldn't find a matching music bed — leaving audio as-is.)`,
		edl: { ...bedrockResult.edl, musicBed: musicBed ?? null },
	};
}

async function resolveMusicBed({
	clip,
	mood,
	query,
}: {
	clip: Clip;
	mood: string;
	query?: string;
}) {
	try {
		return await searchMusicBed({ mood, query });
	} catch (error) {
		console.warn(
			`Music bed search failed for clip ${clip.id}, leaving musicBed unset: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return undefined;
	}
}
