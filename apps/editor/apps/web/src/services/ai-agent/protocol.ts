import { z } from "zod";

/**
 * Wire format for the agent-turn round trip, mirroring Bedrock Converse's
 * own content-block shapes (ContentBlock.TextMember/ToolUseMember/
 * ToolResultMember in @aws-sdk/client-bedrock-runtime) so the server route
 * can pass these through with minimal translation. The client is the loop
 * driver (see agent-runner.ts) — it owns the full message history and
 * resends it (plus new tool results) each turn, since the server is
 * stateless like the rest of this app's API routes.
 */

export const agentContentBlockSchema = z.union([
	z.object({ text: z.string() }),
	z.object({
		toolUse: z.object({
			toolUseId: z.string(),
			name: z.string(),
			input: z.unknown(),
		}),
	}),
	z.object({
		toolResult: z.object({
			toolUseId: z.string(),
			content: z.array(z.union([z.object({ json: z.unknown() }), z.object({ text: z.string() })])),
			status: z.enum(["success", "error"]).optional(),
		}),
	}),
]);
export type AgentContentBlock = z.infer<typeof agentContentBlockSchema>;

export const agentMessageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.array(agentContentBlockSchema),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const agentTurnRequestSchema = z.object({
	messages: z.array(agentMessageSchema).max(60),
});
export type AgentTurnRequest = z.infer<typeof agentTurnRequestSchema>;

export const agentTurnResponseSchema = z.object({
	stopReason: z.enum(["tool_use", "end_turn", "not_configured"]),
	content: z.array(agentContentBlockSchema),
});
export type AgentTurnResponse = z.infer<typeof agentTurnResponseSchema>;
