"use client";

import { useEditor } from "@/editor/use-editor";
import { AiAutoEditButton } from "./ai-auto-edit-button";
import { AutoCaptionButton } from "./auto-caption-button";
import { ExportButton } from "./export-button";
import { ThemeToggle } from "../theme-toggle";

/**
 * Header for the backend-API-driven video editor route
 * (app/editor/video/[video_id]/edit/[clip_id]). Distinct from
 * editor-header.tsx (local projects) because rename/delete/exit here don't map
 * onto local-project semantics — this route's project is a synthetic,
 * in-memory one built from the highlight-api clips (see
 * remote-clips-manager.ts). Reached via a deep link from the highlights grid,
 * so there is no in-editor "back to clips" gallery to return to.
 */
export function VideoEditorHeader() {
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const videoTitle = activeProject?.metadata.name;

	return (
		<header className="bg-background flex h-[3.4rem] items-center justify-between gap-3 px-3 pt-0.5">
			<div className="flex items-center gap-2 min-w-0">
				<span className="text-sm font-medium truncate">{videoTitle}</span>
			</div>

			<div className="flex items-center gap-2 shrink-0">
				<AutoCaptionButton />
				<AiAutoEditButton />
				<ExportButton />
				<ThemeToggle />
			</div>
		</header>
	);
}
