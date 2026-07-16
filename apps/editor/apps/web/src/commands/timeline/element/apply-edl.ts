import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type {
	AudioTrack,
	LibraryAudioElement,
	OverlayTrack,
	SceneTracks,
	TextElement,
	TextTrack,
	TimelineElement,
	VideoElement,
} from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement/track-factory";
import { buildTextElement, buildLibraryAudioElement } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import { buildTransformFromParams, readOpacityFromParams } from "@/rendering";
import { mediaTimeFromSeconds, subMediaTime } from "@/wasm";
import type { Edl, EdlEffect } from "@/services/highlight-api/schema";
import type { ScalarAnimationKey, ScalarChannel, ElementAnimations } from "@/animation/types";

const CAPTIONS_TRACK_NAME = "AI Captions";
const ZOOM_CAPTIONS_TRACK_NAME = "AI Zoom Captions";
const SFX_TRACK_NAME = "AI SFX";

const TICKS_PER_SECOND = Number(mediaTimeFromSeconds({ seconds: 1 }));

// Vertical 9:16 export canvas. camera-pan params are normalized fractions of the
// frame (−0.3..0.3); transform.positionX/Y are canvas-pixel offsets from center
// (see preview/preview-coords.ts), so we scale by these dimensions.
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

/** Build scalar animation keys from plain (time, value) control points. */
function buildScalarKeys(
	points: { t: number; value: number; seg?: "linear" | "bezier" | "step" }[],
): ScalarAnimationKey[] {
	return points.map((p) => ({
		id: generateUUID(),
		time: mediaTimeFromSeconds({ seconds: Math.max(0, p.t) }),
		value: p.value,
		segmentToNext: p.seg ?? "linear",
		tangentMode: "auto",
	}));
}

/**
 * Build the base→peak→base keyframe set for a punch-in zoom, relative to the
 * host element's start time. Ease in, hold, ease out.
 *
 * `base` is the element's existing scale on this axis and `peak = base * scale`.
 * Composing against the base matters: once a channel has keys, the renderer
 * ignores the element's base transform for the whole clip and uses the channel's
 * held edge value — so the keys must return to `base`, not a hard-coded 1.0, or
 * the clip's normal framing breaks outside the zoom window.
 */
function buildZoomScaleKeys({
	relativeAt,
	relativeEnd,
	base,
	scale,
}: {
	relativeAt: number;
	relativeEnd: number;
	base: number;
	scale: number;
}): ScalarAnimationKey[] {
	const span = relativeEnd - relativeAt;
	const rampIn = Math.min(0.3, span * 0.2);
	const rampOut = Math.min(0.3, span * 0.2);
	const peak = base * scale;
	return buildScalarKeys([
		{ t: relativeAt, value: base, seg: "bezier" },
		{ t: relativeAt + rampIn, value: peak, seg: "linear" },
		{ t: relativeEnd - rampOut, value: peak, seg: "bezier" },
		{ t: relativeEnd, value: base, seg: "linear" },
	]);
}

/**
 * Materialize an EDL's `effects[]` onto a set of scene tracks as ORDINARY,
 * user-editable timeline elements. This is the core of "the AI operates the
 * editor for you": each AI decision becomes a normal element the creator can
 * select, move, resize, retime, reparametrize, or delete.
 *
 * Host-element effects attach to the main video element whose timeline span
 * contains the effect's `at`:
 * - "punch-in-zoom" → transform.scaleX/scaleY keyframes.
 * - "camera-pan" → transform.positionX/positionY keyframes (normalized params
 *   scaled by the 9:16 canvas dimensions).
 * - "opacity-fade" → opacity keyframes (mode: in | out | both).
 * Standalone-element effects:
 * - "onomatopoeia-caption" → TextElement on a dedicated "AI Zoom Captions" track
 *   (honors optional style: fontSize/color/fontFamily/fontWeight/background).
 * - type:"sound" (sfx-*) → LibraryAudioElement on an "AI SFX" audio track,
 *   sourced from /sfx/<asset>.wav (served from the editor's public folder).
 *
 * Pure: returns new SceneTracks, never mutates the input. Used both by
 * ApplyEdlCommand (post-load / chip re-apply) and by RemoteClipsManager at
 * scene-build time so every clip opens with its AI edits already in place.
 */
export function applyEdlEffectsToTracks({
	tracks,
	effects,
}: {
	tracks: SceneTracks;
	effects: EdlEffect[] | undefined;
}): SceneTracks {
	if (!effects || effects.length === 0) return tracks;

	// --- 1. Host-element effects (zoom / pan / opacity fade) ---
	// These all attach to the main video element whose timeline span contains
	// the effect's `at`, as keyframe animation channels.
	const hostEffectIds = new Set([
		"punch-in-zoom",
		"camera-pan",
		"opacity-fade",
	]);
	const hostEffects = effects.filter(
		(e) => e.type === "visual" && hostEffectIds.has(e.effectId),
	);

	const videoElements: TimelineElement[] = tracks.main.elements.map((el) => {
		const elStart = Number(el.startTime);
		const elEnd = elStart + Number(el.duration);
		const elStartSeconds = elStart / TICKS_PER_SECOND;

		const effectsForEl = hostEffects.filter((effect) => {
			const atTicks = Number(mediaTimeFromSeconds({ seconds: effect.at }));
			return atTicks >= elStart && atTicks < elEnd;
		});
		if (effectsForEl.length === 0) return el;

		const scaleXKeys: ScalarAnimationKey[] = [];
		const scaleYKeys: ScalarAnimationKey[] = [];
		const posXKeys: ScalarAnimationKey[] = [];
		const posYKeys: ScalarAnimationKey[] = [];
		const opacityKeys: ScalarAnimationKey[] = [];

		// Compose all keyframes against the element's existing base transform, so
		// the channel's held value outside an effect window equals the real base
		// (not a hard-coded 1.0/0), preserving normal framing between effects.
		const base = buildTransformFromParams({ params: el.params });
		const baseOpacity = readOpacityFromParams({ params: el.params });

		for (const effect of effectsForEl) {
			const params = (effect.params ?? {}) as Record<string, unknown>;
			const relativeAt = effect.at - elStartSeconds;
			const relativeEnd = effect.at + effect.duration - elStartSeconds;
			const span = Math.max(0.01, relativeEnd - relativeAt);
			const ramp = Math.min(0.5, span * 0.3);

			if (effect.effectId === "punch-in-zoom") {
				const scale = typeof params.scale === "number" ? params.scale : 1.3;
				scaleXKeys.push(...buildZoomScaleKeys({ relativeAt, relativeEnd, base: base.scaleX, scale }));
				scaleYKeys.push(...buildZoomScaleKeys({ relativeAt, relativeEnd, base: base.scaleY, scale }));
			} else if (effect.effectId === "camera-pan") {
				const fromX = base.position.x + (typeof params.fromX === "number" ? params.fromX : 0) * CANVAS_WIDTH;
				const toX = base.position.x + (typeof params.toX === "number" ? params.toX : 0) * CANVAS_WIDTH;
				const fromY = base.position.y + (typeof params.fromY === "number" ? params.fromY : 0) * CANVAS_HEIGHT;
				const toY = base.position.y + (typeof params.toY === "number" ? params.toY : 0) * CANVAS_HEIGHT;
				posXKeys.push(
					...buildScalarKeys([
						{ t: relativeAt, value: fromX, seg: "bezier" },
						{ t: relativeEnd, value: toX, seg: "linear" },
					]),
				);
				posYKeys.push(
					...buildScalarKeys([
						{ t: relativeAt, value: fromY, seg: "bezier" },
						{ t: relativeEnd, value: toY, seg: "linear" },
					]),
				);
			} else if (effect.effectId === "opacity-fade") {
				const mode = typeof params.mode === "string" ? params.mode : "in";
				if (mode === "in" || mode === "both") {
					opacityKeys.push(
						...buildScalarKeys([
							{ t: relativeAt, value: 0, seg: "bezier" },
							{ t: relativeAt + ramp, value: baseOpacity, seg: "linear" },
						]),
					);
				}
				if (mode === "out" || mode === "both") {
					opacityKeys.push(
						...buildScalarKeys([
							{ t: relativeEnd - ramp, value: baseOpacity, seg: "bezier" },
							{ t: relativeEnd, value: 0, seg: "linear" },
						]),
					);
				}
			}
		}

		const existing: ElementAnimations = el.animations ?? {};
		const animations: ElementAnimations = { ...existing };
		if (scaleXKeys.length > 0) {
			animations["transform.scaleX"] = { keys: scaleXKeys } as ScalarChannel;
			animations["transform.scaleY"] = { keys: scaleYKeys } as ScalarChannel;
		}
		if (posXKeys.length > 0) {
			animations["transform.positionX"] = { keys: posXKeys } as ScalarChannel;
			animations["transform.positionY"] = { keys: posYKeys } as ScalarChannel;
		}
		if (opacityKeys.length > 0) {
			opacityKeys.sort((a, b) => Number(a.time) - Number(b.time));
			animations.opacity = { keys: opacityKeys } as ScalarChannel;
		}

		return { ...el, animations };
	});

	const mainTrack = { ...tracks.main, elements: videoElements as VideoElement[] };

	// --- 2. Onomatopoeia burst captions ---
	const onomatopoeiaEffects = effects.filter(
		(e) => e.effectId === "onomatopoeia-caption" && e.type === "visual",
	);
	const onomatopoeiaElements: TextElement[] = onomatopoeiaEffects.map((effect) => {
		const params = (effect.params ?? {}) as Record<string, unknown>;
		const text = typeof params.text === "string" ? params.text : "!";
		const style = (params.style ?? {}) as Record<string, unknown>;
		const fontSize = typeof style.fontSize === "number" ? style.fontSize : 48;
		// Pass through optional rich styling the LLM may emit.
		const textParams: Record<string, unknown> = {
			content: text,
			fontSize,
			textAlign: "center",
			fontWeight: typeof style.fontWeight === "string" ? style.fontWeight : "bold",
		};
		if (typeof style.color === "string") textParams.color = style.color;
		if (typeof style.fontFamily === "string") textParams.fontFamily = style.fontFamily;
		if (style.background && typeof style.background === "object") {
			textParams.background = style.background;
		}
		return {
			...buildTextElement({
				raw: {
					name: `AI burst: ${text}`,
					duration: mediaTimeFromSeconds({ seconds: effect.duration }),
					params: textParams,
				},
				startTime: mediaTimeFromSeconds({ seconds: effect.at }),
			}),
			id: generateUUID(),
		} as TextElement;
	});

	// --- 3. SFX audio elements ---
	const sfxEffects = effects.filter((e) => e.type === "sound");
	const sfxElements: LibraryAudioElement[] = sfxEffects.map((effect) => {
		const params = (effect.params ?? {}) as Record<string, unknown>;
		const assetKey = typeof params.assetKey === "string" ? params.assetKey : "";
		const sourceUrl = `/sfx/${assetKey.split("/").pop() ?? assetKey}`;
		return {
			...buildLibraryAudioElement({
				sourceUrl,
				name: `AI SFX: ${effect.effectId}`,
				duration: mediaTimeFromSeconds({ seconds: effect.duration }),
				startTime: mediaTimeFromSeconds({ seconds: effect.at }),
			}),
			id: generateUUID(),
		} as LibraryAudioElement;
	});

	// --- Assemble overlay (onomatopoeia) + audio (SFX) tracks, find-or-create ---
	let overlay: OverlayTrack[] = tracks.overlay;
	if (onomatopoeiaElements.length > 0) {
		const existingTrack = overlay.find(
			(track): track is TextTrack =>
				track.type === "text" && track.name === ZOOM_CAPTIONS_TRACK_NAME,
		);
		if (existingTrack) {
			const updated: TextTrack = {
				...existingTrack,
				elements: [...existingTrack.elements, ...onomatopoeiaElements],
			};
			overlay = overlay.map((t) => (t.id === existingTrack.id ? updated : t));
		} else {
			const newTrack: TextTrack = {
				...buildEmptyTrack({ id: generateUUID(), type: "text", name: ZOOM_CAPTIONS_TRACK_NAME }),
				elements: onomatopoeiaElements,
			};
			overlay = [...overlay, newTrack];
		}
	}

	let audio: AudioTrack[] = tracks.audio;
	if (sfxElements.length > 0) {
		const existingTrack = audio.find(
			(track): track is AudioTrack => track.name === SFX_TRACK_NAME,
		);
		if (existingTrack) {
			const updated: AudioTrack = {
				...existingTrack,
				elements: [...existingTrack.elements, ...sfxElements],
			};
			audio = audio.map((t) => (t.id === existingTrack.id ? updated : t));
		} else {
			const newTrack: AudioTrack = {
				...buildEmptyTrack({ id: generateUUID(), type: "audio", name: SFX_TRACK_NAME }),
				elements: sfxElements,
			};
			audio = [...audio, newTrack];
		}
	}

	return { ...tracks, main: mainTrack, overlay, audio };
}

/**
 * Applies an AI-edit EDL (docs/contracts/edl.schema.json) to the currently
 * active scene, following the same snapshot/restore pattern every other
 * command in src/commands/ uses — one execute()/undo() pair, one Ctrl+Z
 * reverts the whole AI edit.
 *
 * Rebuilds the main video track from `edl.segments` (so chip actions like
 * reorder/speed apply), lays down `edl.captions`/`hookOverlay` as text, then
 * delegates `edl.effects[]` (zoom / onomatopoeia / SFX) to
 * applyEdlEffectsToTracks — the same helper RemoteClipsManager uses to bake
 * effects into every scene at load. All become ordinary editable elements.
 */
export class ApplyEdlCommand extends Command {
	private savedState: SceneTracks | null = null;

	constructor(private readonly edl: Edl) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const activeScene = editor.scenes.getActiveScene();
		this.savedState = activeScene.tracks;

		const existingElement = activeScene.tracks.main.elements[0];
		if (!existingElement || !("mediaId" in existingElement)) {
			return undefined;
		}

		const sourceDuration = existingElement.sourceDuration ?? existingElement.duration;

		// --- Rebuild video elements from segments ---
		const videoElements: VideoElement[] = this.edl.segments.map((segment) => {
			const trimStart = mediaTimeFromSeconds({ seconds: segment.sourceStart });
			const trimEnd = subMediaTime({
				a: sourceDuration,
				b: mediaTimeFromSeconds({ seconds: segment.sourceEnd }),
			});
			const startTime = mediaTimeFromSeconds({ seconds: segment.timelineStart });
			const duration = subMediaTime({
				a: mediaTimeFromSeconds({ seconds: segment.timelineEnd }),
				b: startTime,
			});
			return {
				...(existingElement as VideoElement),
				id: generateUUID(),
				name: segment.segmentId,
				startTime,
				duration,
				trimStart,
				trimEnd,
				sourceDuration,
			};
		});

		const mainTrack = { ...activeScene.tracks.main, elements: videoElements };

		// --- Captions + hook overlay (from edl.captions / edl.hookOverlay) ---
		const captionElements = [
			...this.edl.captions.overlays.map((overlay) =>
				buildTextElement({
					raw: {
						name: "AI caption",
						duration: mediaTimeFromSeconds({ seconds: overlay.end - overlay.start }),
						params: { content: overlay.text },
					},
					startTime: mediaTimeFromSeconds({ seconds: overlay.start }),
				}),
			),
			...(this.edl.hookOverlay
				? [
						buildTextElement({
							raw: {
								name: "AI hook",
								duration: mediaTimeFromSeconds({ seconds: this.edl.hookOverlay.duration }),
								params: { content: this.edl.hookOverlay.text, fontSize: 88, textAlign: "center" },
							},
							startTime: mediaTimeFromSeconds({ seconds: this.edl.hookOverlay.start }),
						}),
					]
				: []),
		].map((created) => ({ ...created, id: generateUUID() }) as TextElement);

		let overlay: OverlayTrack[] = activeScene.tracks.overlay;
		if (captionElements.length > 0) {
			const existingCaptionsTrack = overlay.find(
				(track): track is TextTrack =>
					track.type === "text" && track.name === CAPTIONS_TRACK_NAME,
			);
			if (existingCaptionsTrack) {
				const updatedTrack: TextTrack = {
					...existingCaptionsTrack,
					elements: [...existingCaptionsTrack.elements, ...captionElements],
				};
				overlay = overlay.map((track) =>
					track.id === existingCaptionsTrack.id ? updatedTrack : track,
				);
			} else {
				const newTrack: TextTrack = {
					...buildEmptyTrack({ id: generateUUID(), type: "text", name: CAPTIONS_TRACK_NAME }),
					elements: captionElements,
				};
				overlay = [...overlay, newTrack];
			}
		}

		// --- Effects (zoom / onomatopoeia / SFX) via the shared helper ---
		const withEffects = applyEdlEffectsToTracks({
			tracks: { ...activeScene.tracks, main: mainTrack, overlay },
			effects: this.edl.effects,
		});

		editor.timeline.updateTracks(withEffects);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
