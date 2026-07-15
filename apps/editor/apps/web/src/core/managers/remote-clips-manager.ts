import type { EditorCore } from "@/core";
import type { SceneTracks, TScene, VideoElement } from "@/timeline";
import type { TProject } from "@/project/types";
import { generateUUID } from "@/utils/id";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { MAIN_TRACK_NAME } from "@/timeline/placement/main-track";
import {
	type MediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	subMediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { DEFAULT_CANVAS_SIZE } from "@/canvas/sizes";
import { DEFAULT_FPS } from "@/fps/defaults";
import { floatToFrameRate } from "@/fps/utils";
import { CURRENT_PROJECT_VERSION } from "@/services/storage/migrations";
import {
	getClipRenderStatus,
	getVideoClips,
	requestAiEdit,
	startClipRender,
	updateClip,
} from "@/services/highlight-api/client";
import type {
	AiEditRequest,
	AiEditResponse,
	Clip,
	ClipPatch,
	Edl,
	RenderStatusValue,
	ShotBoundary,
} from "@/services/highlight-api/schema";
import { ApplyEdlCommand, applyEdlEffectsToTracks } from "@/commands/timeline/element/apply-edl";

const RENDER_POLL_INTERVAL_MS = 2500;
const RENDER_POLL_TIMEOUT_MS = 60_000;

export class RemoteClipsManager {
	private videoId: string | null = null;
	private clips = new Map<string, Clip>();
	// Every clip's own probed media asset, keyed by clip/scene id — but only
	// the active clip's asset is ever handed to MediaManager.setAssets, so
	// the Assets panel shows just that clip's footage, not all of them (see
	// syncMediaAssetsForActiveScene).
	private clipAssets = new Map<string, MediaAsset>();
	private activeAssetSceneId: string | null = null;
	private unsubscribeFromScenes: (() => void) | null = null;
	private isLoading = false;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	async loadVideo({
		videoId,
		videoTitle,
		initialClipId,
	}: {
		videoId: string;
		videoTitle: string;
		/** Which clip's scene to open first, e.g. from the clips gallery's
		 * "Open in Editor" button. Falls back to the first clip if omitted or
		 * not found among this video's clips. */
		initialClipId?: string;
	}): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			const { clips } = await getVideoClips({ videoId });
			if (clips.length === 0) {
				throw new Error(`Video ${videoId} has no clips`);
			}

			this.videoId = videoId;
			this.clips = new Map(clips.map((clip) => [clip.id, clip]));

			// Each clip owns its own footage (see fixtures.ts) — fetch + probe
			// one media asset per clip, in parallel, rather than one shared VOD.
			// Also fetch each clip's AI-edit EDL (the "auto" action returns the
			// pipeline's pre-computed reaction-zoom / onomatopoeia / SFX effects)
			// so we can bake them into every scene up front — every clip opens
			// with its AI edits already laid down as editable timeline elements.
			const sceneBuildInputs = await Promise.all(
				clips.map(async (clip) => {
					const blob = await fetch(clip.sourceVideoUrl).then((res) => res.blob());
					const file = new File([blob], `${clip.id}.mp4`, {
						type: blob.type || "video/mp4",
					});

					const [processed] = await processMediaAssets({ files: [file] });
					if (!processed) {
						throw new Error(`Failed to probe media for clip ${clip.id}`);
					}

					const mediaAssetId = `media_${clip.id}`;
					const asset: MediaAsset = { ...processed, id: mediaAssetId };
					const sourceDuration = mediaTimeFromSeconds({
						seconds: processed.duration ?? asset.duration ?? 0,
					});

					// Non-blocking: a missing/failed AI edit shouldn't break load,
					// but log failures so they're diagnosable in the console.
					let aiEdl: Edl | null = null;
					try {
						const resp = await requestAiEdit({
							clipId: clip.id,
							request: { chipAction: "auto" },
						});
						aiEdl = resp.edl;
						console.info(
							`[AI auto-edit] ${clip.id}: ${resp.edl.effects?.length ?? 0} effects`,
						);
					} catch (err) {
						console.warn(`[AI auto-edit] ${clip.id} failed:`, err);
						aiEdl = null;
					}

					return { clip, asset, sourceDuration, aiEdl };
				}),
			);

			this.clipAssets = new Map(
				sceneBuildInputs.map(({ clip, asset }) => [clip.id, asset]),
			);

			const scenes: TScene[] = sceneBuildInputs.map(
				({ clip, asset, sourceDuration, aiEdl }, index) => {
					const scene = this.buildSceneForClip({
						clip,
						mediaAssetId: asset.id,
						sourceDuration,
						isMain: index === 0,
					});
					// Bake the AI edits into the scene's tracks as editable elements.
					if (aiEdl?.effects && aiEdl.effects.length > 0) {
						return {
							...scene,
							tracks: applyEdlEffectsToTracks({
								tracks: scene.tracks,
								effects: aiEdl.effects,
							}),
						};
					}
					return scene;
				},
			);

			const currentSceneId =
				(initialClipId && scenes.find((scene) => scene.id === initialClipId)?.id) ||
				scenes[0].id;

			const primary = sceneBuildInputs[0];

			const project: TProject = {
				metadata: {
					id: videoId,
					name: videoTitle,
					duration: primary.sourceDuration,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				scenes,
				currentSceneId,
				settings: {
					fps: primary.asset.fps ? floatToFrameRate(primary.asset.fps) : DEFAULT_FPS,
					canvasSize:
						primary.asset.width && primary.asset.height
							? { width: primary.asset.width, height: primary.asset.height }
							: DEFAULT_CANVAS_SIZE,
					canvasSizeMode: "preset",
					lastCustomCanvasSize: null,
					originalCanvasSize:
						primary.asset.width && primary.asset.height
							? { width: primary.asset.width, height: primary.asset.height }
							: null,
					background: { type: "color", color: DEFAULT_BACKGROUND_COLOR },
				},
				version: CURRENT_PROJECT_VERSION,
			};

			this.editor.project.setActiveProject({ project });
			this.editor.scenes.initializeScenes({
				scenes,
				currentSceneId,
			});

			this.syncMediaAssetsForActiveScene();
			this.unsubscribeFromScenes?.();
			this.unsubscribeFromScenes = this.editor.scenes.subscribe(() => {
				this.syncMediaAssetsForActiveScene();
			});
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	/** Keeps MediaManager's asset list scoped to whichever clip's scene is
	 * currently active, so the Assets panel only ever shows that one clip's
	 * footage — not every clip in the video. Re-run on every scenes-manager
	 * notify (cheap no-op via the id guard) so switching clip tabs (see
	 * video-editor-header.tsx) swaps the visible asset automatically. */
	private syncMediaAssetsForActiveScene(): void {
		const activeSceneId = this.editor.scenes.getActiveSceneOrNull()?.id ?? null;
		if (!activeSceneId || activeSceneId === this.activeAssetSceneId) return;

		const asset = this.clipAssets.get(activeSceneId);
		if (!asset) return;

		this.activeAssetSceneId = activeSceneId;
		this.editor.media.setAssets({ assets: [asset] });
	}

	private buildSceneForClip({
		clip,
		mediaAssetId,
		sourceDuration,
		isMain,
	}: {
		clip: Clip;
		mediaAssetId: string;
		sourceDuration: MediaTime;
		isMain: boolean;
	}): TScene {
		const clipDuration = mediaTimeFromSeconds({
			seconds: clip.end - clip.start,
		});

		const createElement = buildElementFromMedia({
			mediaId: mediaAssetId,
			mediaType: "video",
			name: clip.hook || clip.category,
			duration: clipDuration,
			startTime: ZERO_MEDIA_TIME,
		});

		const element: VideoElement = {
			...(createElement as Omit<VideoElement, "id">),
			id: generateUUID(),
			trimStart: mediaTimeFromSeconds({ seconds: clip.start }),
			trimEnd: subMediaTime({
				a: sourceDuration,
				b: mediaTimeFromSeconds({ seconds: clip.end }),
			}),
			sourceDuration,
		};

		const tracks: SceneTracks = {
			overlay: [],
			main: {
				id: generateUUID(),
				name: MAIN_TRACK_NAME,
				type: "video",
				elements: [element],
				muted: false,
				hidden: false,
			},
			audio: [],
		};

		return {
			id: clip.id,
			name: clip.hook || clip.category,
			isMain,
			tracks,
			bookmarks: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}

	/** Shot boundaries for the currently active clip's own footage (each clip
	 * has its own source video now, see fixtures.ts — shots are per-clip, not
	 * shared across the whole video). */
	getShotBoundaries(): ShotBoundary[] {
		const activeSceneId = this.editor.scenes.getActiveSceneOrNull()?.id;
		if (!activeSceneId) return [];
		return this.clips.get(activeSceneId)?.shots ?? [];
	}

	getClips(): Clip[] {
		return Array.from(this.clips.values());
	}

	getClip({ clipId }: { clipId: string }): Clip | null {
		return this.clips.get(clipId) ?? null;
	}

	getVideoId(): string | null {
		return this.videoId;
	}

	getIsLoading(): boolean {
		return this.isLoading;
	}

	updateClipMetadataDraft({
		clipId,
		patch,
	}: {
		clipId: string;
		patch: Pick<ClipPatch, "hook" | "hookEn" | "caption" | "captionEn" | "hashtags">;
	}): void {
		const existing = this.clips.get(clipId);
		if (!existing) return;

		this.clips.set(clipId, { ...existing, ...patch });
		this.notify();
	}

	/** Requests an AI edit plan (an Edl, docs/contracts/edl.schema.json) for
	 * the given clip, WITHOUT applying it — the clip-metadata panel shows
	 * editPlan.summary for review before the caller decides to applyEdl. */
	async requestAiEdit({
		clipId,
		request,
	}: {
		clipId: string;
		request: AiEditRequest;
	}): Promise<AiEditResponse> {
		return requestAiEdit({ clipId, request });
	}

	/** Applies a reviewed Edl to the active clip's scene as one undo step
	 * (ApplyEdlCommand, src/commands/timeline/element/apply-edl.ts) via the
	 * existing command/undo system — Ctrl+Z reverts the whole AI edit. */
	applyEdl({ edl }: { edl: Edl }): void {
		this.editor.command.execute({ command: new ApplyEdlCommand(edl) });
	}

	private getClipTrimSeconds({ clipId }: { clipId: string }): {
		start: number;
		end: number;
	} | null {
		const scene = this.editor.scenes
			.getScenes()
			.find((candidate) => candidate.id === clipId);
		const element = scene?.tracks.main.elements[0];
		if (!scene || !element || !element.sourceDuration) return null;

		const start = mediaTimeToSeconds({ time: element.trimStart });
		const end = mediaTimeToSeconds({
			time: subMediaTime({ a: element.sourceDuration, b: element.trimEnd }),
		});
		return { start, end };
	}

	async saveAndRender({ clipId }: { clipId: string }): Promise<void> {
		const draft = this.clips.get(clipId);
		if (!draft) throw new Error(`Unknown clip ${clipId}`);

		const trim = this.getClipTrimSeconds({ clipId });

		try {
			const saved = await updateClip({
				clipId,
				patch: {
					...(trim ?? {}),
					hook: draft.hook,
					hookEn: draft.hookEn,
					caption: draft.caption,
					captionEn: draft.captionEn,
					hashtags: draft.hashtags,
				},
			});
			this.clips.set(clipId, saved);
			this.notify();

			const rendering = await startClipRender({ clipId });
			this.clips.set(clipId, rendering);
			this.notify();

			this.pollRenderStatus({ clipId });
		} catch (error) {
			this.setClipRenderStatus({ clipId, status: "failed", previewUrl: null });
			throw error;
		}
	}

	private pollRenderStatus({ clipId }: { clipId: string }): void {
		if (this.pollTimer) clearInterval(this.pollTimer);

		const startedAt = Date.now();
		this.pollTimer = setInterval(async () => {
			if (Date.now() - startedAt > RENDER_POLL_TIMEOUT_MS) {
				this.stopPolling();
				this.setClipRenderStatus({ clipId, status: "failed", previewUrl: null });
				return;
			}

			try {
				const { status, previewUrl } = await getClipRenderStatus({ clipId });
				this.setClipRenderStatus({ clipId, status, previewUrl });

				if (status === "ready" || status === "failed") {
					this.stopPolling();
				}
			} catch {
				this.stopPolling();
				this.setClipRenderStatus({ clipId, status: "failed", previewUrl: null });
			}
		}, RENDER_POLL_INTERVAL_MS);
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private setClipRenderStatus({
		clipId,
		status,
		previewUrl,
	}: {
		clipId: string;
		status: RenderStatusValue;
		previewUrl: string | null;
	}): void {
		const existing = this.clips.get(clipId);
		if (!existing) return;

		this.clips.set(clipId, {
			...existing,
			renderStatus: status,
			previewUrl: previewUrl ?? existing.previewUrl,
		});
		this.notify();
	}

	clear(): void {
		this.stopPolling();
		this.unsubscribeFromScenes?.();
		this.unsubscribeFromScenes = null;
		this.videoId = null;
		this.clips = new Map();
		this.clipAssets = new Map();
		this.activeAssetSceneId = null;
		this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
