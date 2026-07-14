import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { OverlayTrack, SceneTracks, TextElement, TextTrack, VideoElement } from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement/track-factory";
import { buildTextElement } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import { mediaTimeFromSeconds, subMediaTime } from "@/wasm";
import type { Edl } from "@/services/highlight-api/schema";

const CAPTIONS_TRACK_NAME = "AI Captions";

/**
 * Applies an AI-edit EDL (docs/contracts/edl.schema.json) to the currently
 * active scene, following the same snapshot/restore pattern every other
 * command in src/commands/ uses (see split-elements.ts, update-elements.ts)
 * — one execute()/undo() pair, one Ctrl+Z reverts the whole AI edit.
 *
 * v1 scope: every EDL segment is assumed to reference the active clip's own
 * single media asset (cross-clip compilation EDLs are out of scope — each
 * clip has isolated media, see remote-clips-manager.ts). `edl.effects[]` is
 * accepted but not yet visually applied (no effects-library manifest exists
 * — same "illustrative/fast-follow" status the real schema itself assigns
 * that field); `edl.musicBed` likewise. `segments[].crop` is accepted but
 * not applied (no crop-window UI exists in the editor yet).
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

		const mediaId = existingElement.mediaId;
		const sourceDuration = existingElement.sourceDuration ?? existingElement.duration;

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

			const element: VideoElement = {
				...(existingElement as VideoElement),
				id: generateUUID(),
				name: segment.segmentId,
				startTime,
				duration,
				trimStart,
				trimEnd,
				sourceDuration,
			};
			return element;
		});

		const mainTrack = { ...activeScene.tracks.main, elements: videoElements };

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

		editor.timeline.updateTracks({ ...activeScene.tracks, main: mainTrack, overlay });
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
