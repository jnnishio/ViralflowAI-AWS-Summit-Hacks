import type { EditorCore } from "@/core";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { mediaTimeToSeconds } from "@/wasm";
import { executeTool } from "./tool-executor";
import { agentTurnResponseSchema, type AgentContentBlock, type AgentMessage } from "./protocol";

/**
 * Client-side driver for the autonomous editing agent's tool-calling loop.
 *
 * This has to live in the browser: EditorCore/TimelineManager and the WASM
 * MediaTime helpers only exist client-side, so the agent's tool calls must
 * execute here. Bedrock itself is only reachable server-side (API key
 * secrecy), so each "turn" is one stateless round trip to
 * /api/clips/[clip_id]/agent-turn — the server just proxies one Converse
 * call and hands back either more tool-use requests or a final stop. This
 * file owns the loop: execute requested tools against the live editor
 * (immediately, no review gate — Ctrl+Z is the safety net, same as any
 * other editor action), feed results back, repeat.
 */

const MAX_TURNS = 15; // anti-infinite-loop safety net, not a user-facing guardrail

export interface AgentStep {
	name: string;
	input: unknown;
	status: "success" | "error";
	result: unknown;
}

export interface AgentRunResult {
	summary: string;
	steps: AgentStep[];
	stoppedEarly: boolean;
}

export async function runAutonomousEdit({
	editor,
	clipId,
	goal,
	onStep,
}: {
	editor: EditorCore;
	clipId: string;
	goal: string;
	onStep?: (step: AgentStep) => void;
}): Promise<AgentRunResult> {
	const steps: AgentStep[] = [];
	const messages: AgentMessage[] = [
		{
			role: "user",
			content: [{ text: `Goal: ${goal}\n\nCurrent timeline state:\n${serializeTimelineState(editor)}` }],
		},
	];

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		const res = await fetch(`/api/clips/${clipId}/agent-turn`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages }),
		});
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			throw new Error(
				(body && typeof body === "object" && "error" in body ? String(body.error) : null) ??
					`Agent turn failed: ${res.status} ${res.statusText}`,
			);
		}
		const turnResult = agentTurnResponseSchema.parse(await res.json());

		messages.push({ role: "assistant", content: turnResult.content });

		if (turnResult.stopReason !== "tool_use") {
			const summary = extractText(turnResult.content) || "Done.";
			return { summary, steps, stoppedEarly: false };
		}

		const toolUseBlocks = turnResult.content.filter(
			(block): block is Extract<AgentContentBlock, { toolUse: unknown }> => "toolUse" in block,
		);

		const resultBlocks: AgentContentBlock[] = toolUseBlocks.map((block) => {
			const execution = executeTool({
				editor,
				name: block.toolUse.name,
				input: block.toolUse.input,
			});
			const step: AgentStep = {
				name: block.toolUse.name,
				input: block.toolUse.input,
				status: execution.status,
				result: execution.result,
			};
			steps.push(step);
			onStep?.(step);

			return {
				toolResult: {
					toolUseId: block.toolUse.toolUseId,
					content: [{ json: execution.result }],
					status: execution.status,
				},
			};
		});

		messages.push({
			role: "user",
			content: [
				...resultBlocks,
				{ text: `Current timeline state:\n${serializeTimelineState(editor)}` },
			],
		});
	}

	return {
		summary: `Stopped after ${MAX_TURNS} steps (safety limit) — the goal may not be fully complete.`,
		steps,
		stoppedEarly: true,
	};
}

function extractText(content: AgentContentBlock[]): string {
	return content
		.filter((block): block is { text: string } => "text" in block)
		.map((block) => block.text)
		.join(" ")
		.trim();
}

function serializeTimelineState(editor: EditorCore): string {
	const tracks: SceneTracks = editor.scenes.getActiveScene().tracks;
	const allTracks: TimelineTrack[] = [tracks.main, ...tracks.overlay, ...tracks.audio];

	return JSON.stringify(
		allTracks.map((track) => ({
			trackId: track.id,
			type: track.type,
			name: track.name,
			...("muted" in track ? { muted: track.muted } : {}),
			...("hidden" in track ? { hidden: track.hidden } : {}),
			elements: track.elements.map((element) => serializeElement(element)),
		})),
	);
}

function serializeElement(element: TimelineElement): Record<string, unknown> {
	return {
		elementId: element.id,
		type: element.type,
		name: element.name,
		startTimeSeconds: mediaTimeToSeconds({ time: element.startTime }),
		durationSeconds: mediaTimeToSeconds({ time: element.duration }),
		trimStartSeconds: mediaTimeToSeconds({ time: element.trimStart }),
		trimEndSeconds: mediaTimeToSeconds({ time: element.trimEnd }),
		...("hidden" in element ? { hidden: element.hidden } : {}),
		...("retime" in element && element.retime ? { retime: element.retime } : {}),
		...("effects" in element && element.effects?.length
			? { effects: element.effects.map((e) => ({ effectId: e.id, type: e.type })) }
			: {}),
		...(element.type === "text" ? { content: element.params.content } : {}),
	};
}
