/**
 * Pre-computed EDL effects from the pipeline's autoedit module.
 *
 * AUTO-GENERATED from out/3654414-v2/edl/*.edl.json by _gen_fixtures.py.
 * These are the real AI-detected effects (reaction zooms, onomatopoeia
 * burst captions, SFX) for each clip. Clip-id ordering matches fixtures.ts
 * (clip_01..clip_05) per the ordering contract in pipeline/gallery.py.
 *
 * The "auto" chip action in ai-edit-mock.ts returns these so the editor
 * materializes them as editable timeline elements via ApplyEdlCommand.
 */

import type { EdlEffect } from "./schema";

export type EdlEffectsMap = Record<string, EdlEffect[]>;

export const PIPELINE_EDL_EFFECTS: EdlEffectsMap = {
	// clip_01: 7 zoom, 7 caption, 2 sfx
	clip_01: [
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 0.429,
			duration: 1.5,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 2.759,
			duration: 1.2,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 3.92,
			duration: 0.8,
			params: {
				text: "哇!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 4.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.91,
				cy: 0.304
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 7.34,
			duration: 0.8,
			params: {
				text: "NO WAY!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 7.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.6309,
				cy: 0.3053
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 10.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.9495,
				cy: 0.306
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 16.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.9571,
				cy: 0.304
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 16.53,
			duration: 0.8,
			params: {
				text: "真的假的?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 20.05,
			duration: 0.8,
			params: {
				text: "哇!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 22.32,
			duration: 0.8,
			params: {
				text: "哈哈哈!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 22.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.0693,
				cy: 0.3068
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 25.92,
			duration: 0.8,
			params: {
				text: "WHAT?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 26.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.5595,
				cy: 0.3415
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 29.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1505,
				cy: 0.3387
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 29.87,
			duration: 0.8,
			params: {
				text: "真的假的?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
	],
	// clip_02: 11 zoom, 9 caption, 2 sfx
	clip_02: [
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 0.189,
			duration: 0.8,
			params: {
				text: "哇!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 0.2,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1885,
				cy: 0.3337
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 3.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.7558,
				cy: 0.335
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 6.709,
			duration: 0.8,
			params: {
				text: "NO WAY!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 6.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.7634,
				cy: 0.3382
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 10.279,
			duration: 1.5,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 12.529,
			duration: 2.1,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 14.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1896,
				cy: 0.3337
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 14.61,
			duration: 0.8,
			params: {
				text: "OMG!!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 18.2,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1863,
				cy: 0.3337
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 18.29,
			duration: 0.8,
			params: {
				text: "哇!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 21.58,
			duration: 0.8,
			params: {
				text: "笑死!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 21.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.514,
				cy: 0.329
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 24.29,
			duration: 0.8,
			params: {
				text: "嗯?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 29.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.5121,
				cy: 0.1738
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 38.52,
			duration: 0.8,
			params: {
				text: "哇!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 38.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.4317,
				cy: 0.2298
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 42.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.4647,
				cy: 0.2207
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 45.32,
			duration: 0.8,
			params: {
				text: "不會吧!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 45.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1368,
				cy: 0.3252
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 51.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.7863,
				cy: 0.3266
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 51.479,
			duration: 0.8,
			params: {
				text: "哈哈哈!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
	],
	// clip_03: 10 zoom, 10 caption, 2 sfx
	clip_03: [
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 2.52,
			duration: 0.8,
			params: {
				text: "WHAT?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 2.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1759,
				cy: 0.3618
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 6.72,
			duration: 0.8,
			params: {
				text: "欸!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 6.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1608,
				cy: 0.3582
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 9.209,
			duration: 1.4,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 11.38,
			duration: 1.0,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 13.3,
			duration: 0.8,
			params: {
				text: "真的假的?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 13.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.7321,
				cy: 0.3605
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 17.59,
			duration: 0.8,
			params: {
				text: "不會吧!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 17.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.497,
				cy: 0.2523
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 21.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.3733,
				cy: 0.2397
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 21.02,
			duration: 0.8,
			params: {
				text: "笑死!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 23.34,
			duration: 0.8,
			params: {
				text: "嗯?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 27.72,
			duration: 0.8,
			params: {
				text: "真的假的?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 27.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.7362,
				cy: 0.1209
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 33.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1362,
				cy: 0.3344
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 33.419,
			duration: 0.8,
			params: {
				text: "OMG!!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 38.2,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1365,
				cy: 0.3352
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 42.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1273,
				cy: 0.3427
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 42.429,
			duration: 0.8,
			params: {
				text: "哈哈哈!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 46.389,
			duration: 0.8,
			params: {
				text: "HAHA!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 46.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.126,
				cy: 0.3395
			}
		},
	],
	// clip_04: 11 zoom, 11 caption, 2 sfx
	clip_04: [
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 3.07,
			duration: 0.8,
			params: {
				text: "WHAT?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 3.2,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.6657,
				cy: 0.3777
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 5.84,
			duration: 1.1,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 6.32,
			duration: 0.8,
			params: {
				text: "HAHA!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 6.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.2247,
				cy: 0.3014
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 8.17,
			duration: 2.9,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 13.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.6986,
				cy: 0.2814
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 13.0,
			duration: 0.8,
			params: {
				text: "OMG!!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 16.32,
			duration: 0.8,
			params: {
				text: "哇!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 16.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.2908,
				cy: 0.2706
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 22.52,
			duration: 0.8,
			params: {
				text: "哈哈哈!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 22.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.2702,
				cy: 0.2714
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 26.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.66,
				cy: 0.3023
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 29.31,
			duration: 0.8,
			params: {
				text: "HAHA!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 29.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.7137,
				cy: 0.2899
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 32.99,
			duration: 0.8,
			params: {
				text: "真的假的?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 35.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.6832,
				cy: 0.3616
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 35.439,
			duration: 0.8,
			params: {
				text: "不會吧!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 46.72,
			duration: 0.8,
			params: {
				text: "哈哈哈!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 46.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.2661,
				cy: 0.3716
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 50.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1108,
				cy: 0.3611
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 50.028,
			duration: 0.8,
			params: {
				text: "HAHA!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 56.878,
			duration: 0.8,
			params: {
				text: "WHAT?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 57.0,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.6036,
				cy: 0.2679
			}
		},
	],
	// clip_05: 11 zoom, 10 caption, 2 sfx
	clip_05: [
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 7.32,
			duration: 0.8,
			params: {
				text: "WHAT?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 7.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.6486,
				cy: 0.2507
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 8.539,
			duration: 1.8,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 12.32,
			duration: 0.8,
			params: {
				text: "HAHA!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 12.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.3063,
				cy: 0.2935
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 15.72,
			duration: 0.8,
			params: {
				text: "嗯?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 15.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.5413,
				cy: 0.1412
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 19.2,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.619,
				cy: 0.1336
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 24.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.5964,
				cy: 0.1873
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 28.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.599,
				cy: 0.2135
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 28.85,
			duration: 0.8,
			params: {
				text: "哇!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "sfx-comedic-stinger",
			type: "sound",
			at: 31.07,
			duration: 1.8,
			params: {
				assetKey: "sfx/comedic_stinger.wav",
				gainDb: -4
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 32.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1685,
				cy: 0.3475
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 32.84,
			duration: 0.8,
			params: {
				text: "欸!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 37.32,
			duration: 0.8,
			params: {
				text: "HAHA!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 37.4,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1376,
				cy: 0.3409
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 44.709,
			duration: 0.8,
			params: {
				text: "真的假的?!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 44.8,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.5579,
				cy: 0.3932
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 48.469,
			duration: 0.8,
			params: {
				text: "不會吧!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 48.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.5613,
				cy: 0.3872
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 51.51,
			duration: 0.8,
			params: {
				text: "太扯了!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
		{
			effectId: "punch-in-zoom",
			type: "visual",
			at: 51.6,
			duration: 2.0,
			params: {
				scale: 1.3,
				cx: 0.1282,
				cy: 0.335
			}
		},
		{
			effectId: "onomatopoeia-caption",
			type: "visual",
			at: 53.92,
			duration: 0.8,
			params: {
				text: "HAHA!",
				style: {
					fontSize: 120,
					burst: true
				}
			}
		},
	],
};
