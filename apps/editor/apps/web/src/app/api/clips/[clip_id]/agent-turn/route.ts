import { NextResponse } from "next/server";
import {
	ConverseCommand,
	type ContentBlock,
	type ConverseCommandOutput,
	type Message,
	type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { getClipFixture } from "@/services/highlight-api/fixtures";
import { isBedrockConfigured, getBedrockClient, MODEL_ID } from "@/services/highlight-api/bedrock-ai-edit";
import { AGENT_TOOLS } from "@/services/ai-agent/tool-catalog";
import {
	agentTurnRequestSchema,
	type AgentContentBlock,
	type AgentTurnResponse,
} from "@/services/ai-agent/protocol";

/**
 * Stateless proxy for one turn of the autonomous editing agent's
 * tool-calling loop. The client (agent-runner.ts) owns the full message
 * history — including prior toolResult blocks — and resends it each call,
 * since EditorCore/the timeline only exist in the browser (see
 * agent-runner.ts's doc comment) and this route has no session state.
 *
 * Mirrors ai-edit/route.ts's env-check pattern, but there's no scripted
 * mock for a multi-turn tool loop — if AWS isn't configured, this just
 * reports that clearly rather than pretending to run.
 */
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
	const result = agentTurnRequestSchema.safeParse(body);
	if (!result.success) {
		return NextResponse.json(
			{ error: "Invalid agent turn request", details: result.error.flatten().fieldErrors },
			{ status: 400 },
		);
	}

	if (!isBedrockConfigured()) {
		const response: AgentTurnResponse = {
			stopReason: "not_configured",
			content: [
				{
					text: "AWS Bedrock isn't configured on this server, so the autonomous agent can't run. Set AWS_REGION (and credentials) to enable it.",
				},
			],
		};
		return NextResponse.json(response);
	}

	const messages: Message[] = result.data.messages.map((message) => ({
		role: message.role,
		content: message.content as unknown as ContentBlock[],
	}));

	const command = new ConverseCommand({
		modelId: MODEL_ID,
		system: [{ text: buildSystemPrompt({ clip }) }],
		messages,
		toolConfig: {
			// `inputSchema.json` is the SDK's recursive `DocumentType`; our plain
			// JSON-schema object literals satisfy it at runtime but not
			// structurally, hence the cast.
			tools: AGENT_TOOLS.map(
				(tool): Tool => ({
					toolSpec: {
						name: tool.name,
						description: tool.description,
						inputSchema: { json: tool.inputSchema as never },
					},
				}),
			),
		},
		inferenceConfig: { maxTokens: 1500, temperature: 0.2 },
	});

	let resp: ConverseCommandOutput;
	try {
		resp = await getBedrockClient().send(command);
	} catch (error) {
		return NextResponse.json(
			{
				error: "AI agent turn failed",
				details: error instanceof Error ? error.message : String(error),
			},
			{ status: 502 },
		);
	}

	const outputContent = resp.output?.message?.content ?? [];
	const content: AgentContentBlock[] = outputContent.flatMap((block): AgentContentBlock[] => {
		if (block.text !== undefined) {
			return [{ text: block.text }];
		}
		if (block.toolUse?.toolUseId && block.toolUse.name) {
			return [
				{
					toolUse: {
						toolUseId: block.toolUse.toolUseId,
						name: block.toolUse.name,
						input: block.toolUse.input,
					},
				},
			];
		}
		return [];
	});

	const response: AgentTurnResponse = {
		stopReason: resp.stopReason === "tool_use" ? "tool_use" : "end_turn",
		content,
	};
	return NextResponse.json(response);
}

function buildSystemPrompt({ clip }: { clip: NonNullable<ReturnType<typeof getClipFixture>> }): string {
	return `You are a veteran short-form video editor (TikTok / IG Reels / YouTube Shorts) autonomously editing ONE already-selected highlight clip using real editing tools — the same operations a human has in this editor's UI (trim, split, move, delete, duplicate, tracks, text overlays, blur effect, mute/hide).

Clip: ${JSON.stringify({ id: clip.id, category: clip.category, mood: clip.mood, hook: clip.hook, caption: clip.caption })}

Each user turn gives you the current timeline state (tracks/elements with ids, in seconds) and a goal. Call tools to make the requested changes directly — there is no human review step, your tool calls take effect immediately, so:

STRICT SCOPE RULE — the most important rule, follow it even if you think another change would improve the clip:
Only call tools for what the goal explicitly asks for. Do NOT make extra "nice to have" changes, add effects/transitions/text nobody asked for, or keep going once the goal is satisfied. Prefer the fewest tool calls that accomplish the goal.

Work step by step: call one or a few tools, you'll get their results (or errors) plus a refreshed timeline state, then continue or stop. When the goal is fully satisfied, respond with a short plain-text summary of what you did and make NO further tool calls — that ends the run. If a goal is unclear or not achievable with the available tools, say so honestly in your final text response instead of guessing at an unrelated change.`;
}
