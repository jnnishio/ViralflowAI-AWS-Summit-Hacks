"use client";

import Link from "next/link";
import { useEditor } from "@/editor/use-editor";
import { Button } from "@/components/ui/button";
import { ExportButton } from "./export-button";
import { ThemeToggle } from "../theme-toggle";
import { cn } from "@/utils/ui";

/**
 * Header for the backend-API-driven video editor route
 * (app/editor/video/[video_id]). Distinct from editor-header.tsx (local
 * projects) because rename/delete/exit here don't map onto local-project
 * semantics — this route's project is a synthetic, in-memory one built from
 * the highlight-api clips (see remote-clips-manager.ts).
 *
 * The clip strip doubles as OpenCut's existing scene switcher: one scene per
 * AI-detected highlight clip (see remote-clips-manager.ts buildSceneForClip).
 */
export function VideoEditorHeader() {
	const scenes = useEditor((e) => e.scenes.getScenes());
	const activeSceneId = useEditor((e) => e.scenes.getActiveSceneOrNull()?.id);
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const videoTitle = activeProject?.metadata.name;
	const videoId = activeProject?.metadata.id;
	const editor = useEditor();

	return (
		<header className="bg-background flex h-[3.4rem] items-center justify-between gap-3 px-3 pt-0.5">
			<div className="flex items-center gap-2 min-w-0">
				<Link
					href={videoId ? `/editor/video/${videoId}` : "/editor/video"}
					className="text-xs text-muted-foreground shrink-0"
				>
					← Clips
				</Link>
				<span className="text-sm font-medium truncate">{videoTitle}</span>
			</div>

			<nav className="flex items-center gap-1 overflow-x-auto">
				{scenes.map((scene, index) => (
					<Button
						key={scene.id}
						variant={scene.id === activeSceneId ? "default" : "ghost"}
						size="sm"
						className={cn("shrink-0 text-xs")}
						onClick={() => editor.scenes.switchToScene({ sceneId: scene.id })}
					>
						Clip {index + 1}
					</Button>
				))}
			</nav>

			<div className="flex items-center gap-2 shrink-0">
				<span className="text-xs text-muted-foreground">Offline export</span>
				<ExportButton />
				<ThemeToggle />
			</div>
		</header>
	);
}
