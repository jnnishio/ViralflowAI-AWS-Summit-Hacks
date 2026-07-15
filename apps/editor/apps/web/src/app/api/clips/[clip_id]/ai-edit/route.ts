import { NextResponse } from "next/server";
import { aiEditRequestSchema, type AiEditResponse } from "@/services/highlight-api/schema";
import { getClipFixture } from "@/services/highlight-api/fixtures";
import { generateMockAiEditResponse } from "@/services/highlight-api/ai-edit-mock";

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

	const response = await getAiEditResponse({ clip, request: result.data });
	return NextResponse.json(response);
}

/**
 * Two-tier by design (see plan's troubleshooting notes): real Bedrock when
 * configured, deterministic mock otherwise. The real branch is intentionally
 * NOT wired here — `@aws-sdk/client-bedrock-runtime` isn't a dependency of
 * this app yet, and no AWS credentials are available to verify a real call
 * against in this environment. Wiring it is: add the SDK dependency, then
 * replace this branch with a ConverseCommand call using a system prompt
 * that forces a single JSON object matching aiEditResponseSchema (mirroring
 * pipeline/director.py's "reply with ONLY a JSON object" pattern), zod-
 * parsed before ever reaching the client — never swap that validation step
 * out, it's the actual safety boundary described in schema.ts.
 */
async function getAiEditResponse({
	clip,
	request,
}: Parameters<typeof generateMockAiEditResponse>[0]): Promise<AiEditResponse> {
	if (process.env.AWS_REGION) {
		console.warn(
			"AWS_REGION is set but real Bedrock calling isn't wired yet (no SDK dependency) — using the mock AI-edit generator.",
		);
	}
	return generateMockAiEditResponse({ clip, request });
}
