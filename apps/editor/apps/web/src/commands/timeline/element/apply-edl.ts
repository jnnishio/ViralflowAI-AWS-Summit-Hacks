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
import { mediaTimeFromSeconds, subMediaTime } from "@/wasm";
import type { Edl, EdlEffect } from "@/services/highlight-api/schema";
import type { ScalarAnimationKey, ScalarChannel, ElementAnimations } from "@/animation/types";

const CAPTIONS_TRACK_NAME = "AI Captions";
const ZOOM_CAPTIONS_TRACK_NAME = "AI Zoom Captions";
const SFX_TRACK_NAME = "AI SFX";

const TICKS_PER_SECOND = Number(mediaTimeFromSeconds({ seconds: 1 }));

/**
 * Build the base→scale→base keyframe set for a punch-in zoom, relative to the
 * host element's start time. Ease in, hold, ease out.
 */
function buildZoomScaleKeys({
	relativeAt,
	relativeEnd,
	scale,
}: {
	relativeAt: number;
	relativeEnd: number;
	scale: number;
}): ScalarAnimationKey[] {
	const span = relativeEnd - relativeAt;
	const rampIn = Math.min(0.3, span * 0.2);
	const rampOut = Math.min(0.3, span * 0.2);
	return [
		{
			id: generateUUID(),
			time: mediaTimeFromSeconds({ seconds: relativeAt }),
			value: 1.0,
			segmentToNext: "bezier",
			tangentMode: "auto",
		},
		{
			id: generateUUID(),
			time: mediaTimeFromSeconds({ seconds: relativeAt + rampIn }),
			value: scale,
			segmentToNext: "linear",
			tangentMode: "auto",
		},
		{
			id: generateUUID(),
			time: mediaTimeFromSeconds({ seconds: relativeEnd - rampOut }),
			value: scale,
			segmentToNext: "bezier",
			tangentMode: "auto",
		},
		{
			id: generateUUID(),
			time: mediaTimeFromSeconds({ seconds: relativeEnd }),
			value: 1.0,
			segmentToNext: "linear",
			tangentMode: "auto",
		},
	];
}

/**
 * Materialize an EDL's `effects[]` onto a set of scene tracks as ORDINARY,
 * user-editable timeline elements. This is the core of "the AI operates the
 * editor for you": each AI decision becomes a normal element the creator can
 * select, move, resize, retime, reparametrize, or delete.
 *
 * - "punch-in-zoom" → transform.scaleX/scaleY keyframes on the video element
 *   whose timeline span contains the effect's `at`.
 * - "onomatopoeia-caption" → TextElement on a dedicated "AI Zoom Captions" track.
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

	// --- 1. Zoom keyframes on the video elements they land within ---
	const zoomEffects = effects.filter(
		(e) => e.effectId === "punch-in-zoom" && e.type === "visual",
	);

	const videoElements: TimelineElement[] = tracks.main.elements.map((el) => {
		const elStart = Number(el.startTime);
		const elEnd = elStart + Number(el.duration);
		const elStartSeconds = elStart / TICKS_PER_SECOND;

		const zoomsForEl = zoomEffects.filter((effect) => {
			const atTicks = Number(mediaTimeFromSeconds({ seconds: effect.at }));
			return atTicks >= elStart && atTicks < elEnd;
		});
		if (zoomsForEl.length === 0) return el;

		// Merge all zoom keyframes for this element onto scaleX/scaleY channels.
		const scaleXKeys: ScalarAnimationKey[] = [];
		const scaleYKeys: ScalarAnimationKey[] = [];
		for (const effect of zoomsForEl) {
			const params = (effect.params ?? {}) as Record<string, unknown>;
			const scale = typeof params.scale === "number" ? params.scale : 1.3;
			const relativeAt = effect.at - elStartSeconds;
			const relativeEnd = effect.at + effect.duration - elStartSeconds;
			scaleXKeys.push(...buildZoomScaleKeys({ relativeAt, relativeEnd, scale }));
			scaleYKeys.push(...buildZoomScaleKeys({ relativeAt, relativeEnd, scale }));
		}

		const scaleXChannel: ScalarChannel = { keys: scaleXKeys };
		const scaleYChannel: ScalarChannel = { keys: scaleYKeys };
		const existing: ElementAnimations = el.animations ?? {};
		return {
			...el,
			animations: {
				...existing,
				"transform.scaleX": scaleXChannel,
				"transform.scaleY": scaleYChannel,
			},
		};
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
		const fontSize = typeof style.fontSize === "number" ? style.fontSize : 120;
		return {
			...buildTextElement({
				raw: {
					name: `AI burst: ${text}`,
					duration: mediaTimeFromSeconds({ seconds: effect.duration }),
					params: {
						content: text,
						fontSize,
						textAlign: "center",
						fontWeight: "bold",
					},
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
