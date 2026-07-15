"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { runAutonomousEdit, type AgentStep } from "@/services/ai-agent/agent-runner";

const AGENT_GOAL_PRESETS: { label: string; goal: string }[] = [
	{ label: "Faster pacing", goal: "Speed up the pacing of this clip by about 30%." },
	{ label: "Reorder shots", goal: "Reorder the clip's shots for stronger flow, leading with its most impactful moment." },
	{ label: "Add reaction zoom", goal: "Add a punch-in zoom effect at the clip's most expressive moment." },
	{ label: "Add hook caption", goal: "Add the clip's hook text as an on-screen caption at the very start." },
];

/**
 * AI Edit panel: describe an edit in natural language and the local agent
 * runner (see services/ai-agent/agent-runner.ts) applies it live to the
 * currently active scene (== the currently open highlight clip). Sits next
 * to PreviewPanel so edits are visible as they land. Split out of
 * ClipMetadataPanel, which now only holds hook/caption/hashtag fields.
 */
export function AiEditPanel() {
	const editor = useEditor();
	const activeSceneId = useEditor(
		(e) => e.scenes.getActiveSceneOrNull()?.id ?? null,
	);
	const clip = useEditor((e) =>
		activeSceneId ? e.remoteClips.getClip({ clipId: activeSceneId }) : null,
	);

	const [goal, setGoal] = useState("");
	const [isRunning, setIsRunning] = useState(false);
	const [steps, setSteps] = useState<AgentStep[]>([]);
	const [summary, setSummary] = useState<string | null>(null);

	useEffect(() => {
		setGoal("");
		setSteps([]);
		setSummary(null);
	}, [clip?.id]);

	if (!activeSceneId || !clip) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<p className="text-muted-foreground text-sm">No clip selected</p>
			</div>
		);
	}

	const runAgent = async (goalText: string) => {
		if (!goalText.trim()) return;
		setIsRunning(true);
		setSteps([]);
		setSummary(null);
		try {
			const run = await runAutonomousEdit({
				editor,
				clipId: clip.id,
				goal: goalText,
				onStep: (step) => setSteps((prev) => [...prev, step]),
			});
			setSummary(run.summary);
			if (!run.stoppedEarly) {
				toast.success("AI agent finished — Ctrl+Z to undo any step");
			}
		} catch (error) {
			toast.error("AI agent run failed", {
				description: error instanceof Error ? error.message : "Please try again",
			});
		} finally {
			setIsRunning(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="flex flex-col gap-2 p-3">
				<label className="text-xs text-muted-foreground">
					AI Edit — runs autonomously, edits apply live (Ctrl+Z to undo)
				</label>

				{steps.length > 0 && (
					<div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
						{steps.map((step, index) => (
							<div key={index} className="flex items-center gap-1.5 text-xs">
								<Badge
									variant={step.status === "success" ? "secondary" : "destructive"}
									className="shrink-0 text-[10px]"
								>
									{step.status === "success" ? "✓" : "✗"}
								</Badge>
								<span className="truncate">{formatStepName(step.name)}</span>
							</div>
						))}
						{isRunning && <p className="text-xs text-muted-foreground">Thinking...</p>}
						{summary && <p className="pt-1 text-xs">{summary}</p>}
					</div>
				)}

				<div className="flex flex-wrap gap-1">
					{AGENT_GOAL_PRESETS.map((preset) => (
						<Button
							key={preset.label}
							variant="outline"
							size="sm"
							disabled={isRunning}
							onClick={() => runAgent(preset.goal)}
						>
							{preset.label}
						</Button>
					))}
				</div>
				<Textarea
					placeholder="Describe what you want the agent to do..."
					value={goal}
					onChange={(e) => setGoal(e.target.value)}
					rows={2}
				/>
				<Button
					variant="outline"
					size="sm"
					disabled={isRunning || !goal.trim()}
					onClick={() => {
						const goalText = goal;
						setGoal("");
						runAgent(goalText);
					}}
				>
					{isRunning ? "Running..." : "Run"}
				</Button>
			</div>
		</ScrollArea>
	);
}

function formatStepName(toolName: string): string {
	return toolName.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
