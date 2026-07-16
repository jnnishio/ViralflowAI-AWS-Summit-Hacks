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
	applyClipCaptions,
	getClipRenderStatus,
	getVideoClips,
	requestAiEdit,
	startClipRender,
	updateClip,
} from "@/services/highlight-api/client";
import { videoCache } from "@/services/video-cache/service";
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
	// Each clip's probed source duration (MediaTime), needed to lay a clip's
	// footage onto the shared compilation timeline (see openCompilation).
	private clipSourceDurations = new Map<string, MediaTime>();
	// When a compilation reel is opened (openCompilation), the id of the
	// synthetic scene concatenating its member clips, and every member clip's
	// media asset — so the Assets panel / preview see ALL of them at once
	// rather than the single-asset-per-scene default (syncMediaAssets...).
	private compilationSceneId: string | null = null;
	private compilationMemberAssets: MediaAsset[] = [];
	// Raw (pre-caption) asset per clip, stashed the first time captions are
	// applied so the "Auto Caption" button can toggle back to unedited footage.
	private rawClipAssets = new Map<string, MediaAsset>();
	// Captioned asset per clip, cached after the first burn so toggling
	// captions back on is an instant in-memory swap (the server burn is also
	// idempotent, but this avoids the re-fetch/re-probe round-trip).
	private captionedAssets = new Map<string, MediaAsset>();
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

					return { clip, asset, sourceDuration };
				}),
			);

			this.clipAssets = new Map(
				sceneBuildInputs.map(({ clip, asset }) => [clip.id, asset]),
			);
			this.clipSourceDurations = new Map(
				sceneBuildInputs.map(({ clip, sourceDuration }) => [clip.id, sourceDuration]),
			);

			// Clips open CLEAN — no baked-in effects. The AI auto-edit
			// (reaction-zoom / onomatopoeia / SFX) is applied on demand from the
			// "AI Auto-Edit" header button (components/editor/ai-auto-edit-button.tsx)
			// via requestAiEdit({ chipAction: "auto" }) -> applyEdl, so the AI's
			// work is a visible, single-undo action the creator triggers.
			const scenes: TScene[] = sceneBuildInputs.map(
				({ clip, asset, sourceDuration }, index) =>
					this.buildSceneForClip({
						clip,
						mediaAssetId: asset.id,
						sourceDuration,
						isMain: index === 0,
					}),
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

		// The compilation scene concatenates several clips, so it needs ALL its
		// member assets registered at once — not the single-asset default.
		if (activeSceneId === this.compilationSceneId) {
			if (this.compilationMemberAssets.length === 0) return;
			this.activeAssetSceneId = activeSceneId;
			this.editor.media.setAssets({ assets: this.compilationMemberAssets });
			return;
		}

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

	/**
	 * Opens a COMPILATION reel (pipeline/compile_edl.py's multi-clip EDL) as a
	 * single new scene whose main track concatenates the reel's member clips
	 * end to end — each segment cut from its OWN already-probed footage (unlike
	 * ApplyEdlCommand, which re-cuts one clip). The EDL's cross-clip effects
	 * (reaction zooms / fades / transitions) are materialized as ordinary,
	 * editable timeline elements via the shared applyEdlEffectsToTracks helper,
	 * so the creator can tweak the AI's compilation edit just like any clip's.
	 *
	 * Requires loadVideo() to have run first (it probes every clip's asset).
	 * Adds the scene as a new tab and switches to it.
	 */
	openCompilation({ compilationId, edl }: { compilationId: string; edl: Edl }): void {
		const sceneId = `compilation_${compilationId}`;

		// Collect each referenced member clip's asset once, preserving order.
		const memberAssets: MediaAsset[] = [];
		const seen = new Set<string>();
		for (const segment of edl.segments) {
			const asset = this.clipAssets.get(segment.clipId);
			if (asset && !seen.has(asset.id)) {
				seen.add(asset.id);
				memberAssets.push(asset);
			}
		}
		if (memberAssets.length === 0) {
			throw new Error("Compilation references no loaded clips");
		}

		const scene = this.buildCompilationScene({ sceneId, edl });

		this.compilationSceneId = sceneId;
		this.compilationMemberAssets = memberAssets;

		const scenes = this.editor.scenes
			.getScenes()
			.filter((existing) => existing.id !== sceneId);
		this.editor.scenes.setScenes({
			scenes: [...scenes, scene],
			activeSceneId: sceneId,
		});

		// Force a re-sync (the guard short-circuits when the active id is
		// unchanged, but the compilation scene is brand new here).
		this.activeAssetSceneId = null;
		this.syncMediaAssetsForActiveScene();
		this.notify();
	}

	/** Build the compilation scene's tracks: one video element per EDL segment,
	 * each cut from its member clip's footage and positioned on the shared
	 * timeline, then the EDL's effects laid down as editable elements. */
	private buildCompilationScene({
		sceneId,
		edl,
	}: {
		sceneId: string;
		edl: Edl;
	}): TScene {
		const videoElements: VideoElement[] = [];
		for (const segment of edl.segments) {
			const asset = this.clipAssets.get(segment.clipId);
			const sourceDuration = this.clipSourceDurations.get(segment.clipId);
			if (!asset || !sourceDuration) continue;

			const startTime = mediaTimeFromSeconds({ seconds: segment.timelineStart });
			const duration = subMediaTime({
				a: mediaTimeFromSeconds({ seconds: segment.timelineEnd }),
				b: startTime,
			});
			const trimStart = mediaTimeFromSeconds({ seconds: segment.sourceStart });
			const trimEnd = subMediaTime({
				a: sourceDuration,
				b: mediaTimeFromSeconds({ seconds: segment.sourceEnd }),
			});

			const created = buildElementFromMedia({
				mediaId: asset.id,
				mediaType: "video",
				name: segment.segmentId,
				duration,
				startTime,
			});

			videoElements.push({
				...(created as Omit<VideoElement, "id">),
				id: generateUUID(),
				trimStart,
				trimEnd,
				sourceDuration,
			} as VideoElement);
		}

		const baseTracks: SceneTracks = {
			overlay: [],
			main: {
				id: generateUUID(),
				name: MAIN_TRACK_NAME,
				type: "video",
				elements: videoElements,
				muted: false,
				hidden: false,
			},
			audio: [],
		};

		const tracks = applyEdlEffectsToTracks({
			tracks: baseTracks,
			effects: edl.effects,
		});

		return {
			id: sceneId,
			name: "Compilation reel",
			isMain: false,
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

	/**
	 * Burns TikTok-style karaoke captions onto this clip SERVER-SIDE (reusing
	 * the pipeline's word-level Transcribe timings, see
	 * pipeline/caption_burn.py) and swaps the active clip's footage in place
	 * for the captioned result. Grid clips ship RAW; this is the on-demand
	 * "Auto Caption" action, so the creator opts in per clip (and can skip it,
	 * e.g. on singing clips where Transcribe struggles).
	 *
	 * The captions are burned into the footage (matching the old baked-in
	 * quality) rather than added as editable text elements — that's the
	 * deliberate tradeoff for pixel-identical output.
	 */
	async applyServerCaptions({ clipId }: { clipId: string }): Promise<void> {
		const clip = this.clips.get(clipId);
		if (!clip) throw new Error(`Unknown clip ${clipId}`);

		// Stash the current (raw) asset once, so undo can restore it.
		if (!this.rawClipAssets.has(clipId)) {
			const current = this.clipAssets.get(clipId);
			if (current) this.rawClipAssets.set(clipId, current);
		}

		let asset = this.captionedAssets.get(clipId);
		if (!asset) {
			const { previewUrl } = await applyClipCaptions({ clipId });
			if (!previewUrl) throw new Error("Caption burn returned no preview URL");

			const blob = await fetch(previewUrl).then((res) => res.blob());
			const file = new File([blob], `${clipId}_captioned.mp4`, {
				type: blob.type || "video/mp4",
			});

			const [processed] = await processMediaAssets({ files: [file] });
			if (!processed) {
				throw new Error(`Failed to probe captioned media for clip ${clipId}`);
			}

			// Reuse the clip's media id so the scene's video element keeps
			// referencing it — we only swap the underlying footage in place.
			asset = { ...processed, id: `media_${clipId}` };
			this.captionedAssets.set(clipId, asset);
		}

		this.swapClipFootage({ clipId, asset });
	}

	/** Reverts applyServerCaptions by swapping the captioned footage back to
	 * the clip's original raw footage. No-op if captions were never applied. */
	removeServerCaptions({ clipId }: { clipId: string }): void {
		const raw = this.rawClipAssets.get(clipId);
		if (!raw) return;
		this.swapClipFootage({ clipId, asset: raw });
	}

	/** Swaps a clip's underlying footage in place (same media id, so the
	 * scene's video element keeps referencing it). Clears the decoded-frame
	 * cache (keyed by mediaId, see video-cache/service.ts) so the preview
	 * re-decodes from the new file rather than showing stale frames. */
	private swapClipFootage({
		clipId,
		asset,
	}: {
		clipId: string;
		asset: MediaAsset;
	}): void {
		videoCache.clearVideo({ mediaId: asset.id });
		this.clipAssets.set(clipId, asset);
		if (this.editor.scenes.getActiveSceneOrNull()?.id === clipId) {
			this.editor.media.setAssets({ assets: [asset] });
		}
		this.notify();
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
		this.clipSourceDurations = new Map();
		this.rawClipAssets = new Map();
		this.captionedAssets = new Map();
		this.activeAssetSceneId = null;
		this.compilationSceneId = null;
		this.compilationMemberAssets = [];
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
