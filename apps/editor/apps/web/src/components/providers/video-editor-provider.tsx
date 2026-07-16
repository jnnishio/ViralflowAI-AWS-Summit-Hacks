"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useKeybindingsListener } from "@/actions/use-keybindings";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { useTimelineStore } from "@/timeline/timeline-store";
import { useEditorActions } from "@/actions/use-editor-actions";
import { loadFontAtlas } from "@/fonts/google-fonts";
import {
	initializeGpuRenderer,
	isGpuAvailable,
} from "@/services/renderer/gpu-renderer";
import { getCompilationEdl, listVideos } from "@/services/highlight-api/client";

interface VideoEditorProviderProps {
	videoId: string;
	/** Clip to open first, e.g. from the clips gallery's "Open in Editor"
	 * button. See remote-clips-manager.ts loadVideo's initialClipId. */
	initialClipId?: string;
	/** When set (highlights grid's "Open compilation in editor"), load this
	 * reel's multi-clip EDL after the clips and open it as one timeline. */
	compilationId?: string;
	children: React.ReactNode;
}

/**
 * Backend-API-driven counterpart to components/providers/editor-provider.tsx.
 * Loads a VOD's AI-detected highlight clips from the highlight-api instead of
 * a local IndexedDB project via editor.remoteClips.loadVideo(...). The local
 * project-loading path (editor-provider.tsx, editor.project.loadProject) is
 * untouched.
 */
export function VideoEditorProvider({
	videoId,
	initialClipId,
	compilationId,
	children,
}: VideoEditorProviderProps) {
	const isRemoteLoading = useEditor((e) => e.remoteClips.getIsLoading());
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const [error, setError] = useState<string | null>(null);
	const [hasStarted, setHasStarted] = useState(false);
	const { setLoadingProject } = useKeybindingsStore();

	useEffect(() => {
		setLoadingProject(!hasStarted || isRemoteLoading);
	}, [hasStarted, isRemoteLoading, setLoadingProject]);

	useEffect(() => {
		let cancelled = false;
		const editor = EditorCore.getInstance();

		const load = async () => {
			try {
				await initializeGpuRenderer();
				editor.renderer.setDegraded(!isGpuAvailable());

				const videos = await listVideos();
				const video = videos.find((candidate) => candidate.id === videoId);
				if (!video) {
					throw new Error(`Video ${videoId} not found`);
				}

				await editor.remoteClips.loadVideo({
					videoId: video.id,
					videoTitle: video.title,
					initialClipId,
				});

				if (cancelled) return;

				// Deep-linked from a compiled reel: load its multi-clip EDL and
				// open it as one concatenated timeline over the clips just built.
				if (compilationId) {
					const { edl } = await getCompilationEdl({
						videoId: video.id,
						compilationId,
					});
					if (cancelled) return;
					editor.remoteClips.openCompilation({ compilationId, edl });
				}

				setHasStarted(true);
				loadFontAtlas();
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Failed to load video");
				setHasStarted(true);
			}
		};

		load();

		return () => {
			cancelled = true;
			editor.remoteClips.clear();
		};
	}, [videoId, initialClipId, compilationId]);

	if (error) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<p className="text-destructive text-sm">{error}</p>
				</div>
			</div>
		);
	}

	if (!hasStarted || isRemoteLoading || !activeProject) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">Loading highlights...</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<VideoEditorRuntimeBindings />
			{children}
		</>
	);
}

function VideoEditorRuntimeBindings() {
	const editor = useEditor();
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);

	useEffect(() => {
		editor.command.isRippleEnabled = rippleEditingEnabled;
	}, [editor, rippleEditingEnabled]);

	useEditorActions();
	useKeybindingsListener();
	return null;
}
