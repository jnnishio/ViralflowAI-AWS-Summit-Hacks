import type { Clip, RenderStatusValue, ShotBoundary, Video } from "./schema";

/**
 * In-memory mock of the AI Highlight Clip backend. Stands in for the
 * (not-yet-built) API Gateway + Lambda + DynamoDB stack described in
 * INTEGRATION_CONTRACT.md. Text content (hook/caption/hashtags/mood/
 * category/score) is copied verbatim from the real pipeline run's
 * out/clips/manifest.json, in the same order as out/clips/gallery.html's
 * cards, so gallery.html's "Open in Editor" buttons (clip_01..clip_05) open
 * an editor session whose clip metadata matches what the card shows.
 *
 * Each clip is given its OWN distinct sample video (public/sample-videos/)
 * rather than all clips sharing one file trimmed to different (overlapping)
 * windows — the real ~96-minute langlive VOD, and the real per-clip renders
 * cut from it, aren't available in this repo (only thumbnails are). Sharing
 * one short placeholder video with overlapping trims made every "clip" look
 * like the same clip; giving each its own file fixes that at the mock layer.
 * start/end are trim offsets into that clip's own footage, not shared-VOD
 * timestamps — see schema.ts's Clip type comment.
 *
 * Server-process-lifetime only — resets on restart. That's fine for a mock;
 * swapping this module for real HTTP calls to AWS is the intended next step.
 */

const VIDEO_ID = "video_6910008";

// Same-origin (public/sample-videos) so RemoteClipsManager.loadVideo's
// fetch()-as-blob doesn't hit cross-origin CORS blocks. Five distinct real
// clips (not five trims of one file) so each "Open in Editor" button shows
// visibly different footage. All ~10s; exact duration gets re-probed
// client-side via processMediaAssets anyway, so approximate end values here
// are just a reasonable initial trim range, not authoritative.
const SAMPLE_CLIPS = [
	{ id: "clip_01", file: "mov_bbb.mp4" },
	{ id: "clip_02", file: "flower.mp4" },
	{ id: "clip_03", file: "sintel.mp4" },
	{ id: "clip_04", file: "jellyfish.mp4" },
	{ id: "clip_05", file: "bigbuckbunny.mp4" },
] as const;

const SAMPLE_SHOTS: ShotBoundary[] = [
	{ start: 0, end: 2.5, confidence: 98.2 },
	{ start: 2.5, end: 5, confidence: 96.7 },
	{ start: 5, end: 7.5, confidence: 99.1 },
	{ start: 7.5, end: 10, confidence: 94.3 },
];

const video: Video = {
	id: VIDEO_ID,
	title: "langlive idol-show VOD (6910008)",
	videoUrl: `/sample-videos/${SAMPLE_CLIPS[0].file}`,
	mediaAssetId: "media_6910008_overview",
	durationSeconds: 10,
	createdAt: new Date().toISOString(),
};

const clips = new Map<string, Clip>(
	[
		{
			id: "clip_01",
			videoId: VIDEO_ID,
			score: 72,
			category: "song performance",
			mood: "emotional",
			hook: "閉眼深情彈唱🎸",
			hookEn: "Eyes-closed acoustic performance",
			caption: "韋綸閉上眼睛、深情投入地自彈自唱，歌聲讓直播間瞬間安靜下來💙 你有被這把聲音打動嗎？",
			captionEn:
				"Weilun closes his eyes and pours his heart into this acoustic performance — the live chat couldn't stop flooding with hearts 🎸❤️",
			hashtags: ["#黃韋綸", "#自彈自唱", "#acoustic", "#直播精華", "#LivePerformance"],
		},
		{
			id: "clip_02",
			videoId: VIDEO_ID,
			score: 72,
			category: "song performance",
			mood: "hype",
			hook: "自彈自唱🎹🎸",
			hookEn: "Live guitar & keys duo",
			caption: "兩位男神同台自彈自唱，吉他配鍵盤超有感覺✨直播現場氣氛超好！",
			captionEn:
				"An intimate live duo performance with guitar and keyboard – the vibe is immaculate 🎶",
			hashtags: ["#自彈自唱", "#直播精華", "#吉他", "#鍵盤", "#黃韋綸"],
		},
		{
			id: "clip_03",
			videoId: VIDEO_ID,
			score: 72,
			category: "song performance",
			mood: "emotional",
			hook: "超浪漫現場彈唱😍",
			hookEn: "Heartfelt acoustic performance",
			caption: "閉上眼睛，用吉他訴說最深的情感🎸❤️ 直播現場粉絲全被融化了！",
			captionEn:
				"Eyes closed, pouring his heart out on guitar 🎸❤️ The live audience was completely swept away!",
			hashtags: ["#黃韋綸", "#吉他彈唱", "#直播精華", "#情歌", "#acousticcover"],
		},
		{
			id: "clip_04",
			videoId: VIDEO_ID,
			score: 68,
			category: "song performance",
			mood: "emotional",
			hook: "原創情歌太催淚😭",
			hookEn: "Original song live performance",
			caption: "韋綸閉眼深情演唱自創曲《愛情旅行》🎸「管你不在我左右，忍不住哭泣」每一句都戳心❤️",
			captionEn:
				"Singer pours his heart into his original love song on acoustic guitar — fans in chat couldn't stop flooding hearts ❤️",
			hashtags: ["#韋綸", "#愛情旅行", "#原創歌曲", "#吉他彈唱", "#直播精華"],
		},
		{
			id: "clip_05",
			videoId: VIDEO_ID,
			score: 62,
			category: "guest story & song reveal",
			mood: "wholesome",
			hook: "18歲站主場😲",
			hookEn: "On stage at 18",
			caption:
				"從籃球校隊到站上主場，韋綸分享青春往事，聊著聊著竟然臨時決定唱自己寫的歌《愛情旅行》🎵 這段對話太有畫面了！",
			captionEn:
				"From school basketball team to performing on stage at 18 — and now surprising everyone with an original song 'Love Journey' inspired by the chat 🎵",
			hashtags: ["#黃韋綸", "#愛情旅行", "#原創歌曲", "#青春回憶", "#籃球"],
		},
	].map((entry, index) => {
		const sample = SAMPLE_CLIPS[index];
		const clip: Clip = {
			...entry,
			sourceVideoUrl: `/sample-videos/${sample.file}`,
			start: 0,
			end: 10,
			shots: SAMPLE_SHOTS,
			thumbKey: null,
			renderStatus: "idle" as RenderStatusValue,
			previewUrl: null,
		};
		return [clip.id, clip] as const;
	}),
);

const renderTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

export function listVideosFixture(): Video[] {
	return [video];
}

export function getVideoFixture({ videoId }: { videoId: string }): Video | null {
	return video.id === videoId ? video : null;
}

export function getVideoClipsFixture({ videoId }: { videoId: string }): {
	clips: Clip[];
} {
	const videoClips = Array.from(clips.values()).filter(
		(clip) => clip.videoId === videoId,
	);
	return { clips: videoClips };
}

export function getClipFixture({ clipId }: { clipId: string }): Clip | null {
	return clips.get(clipId) ?? null;
}

export function patchClipFixture({
	clipId,
	patch,
}: {
	clipId: string;
	patch: Partial<
		Pick<
			Clip,
			"start" | "end" | "hook" | "hookEn" | "caption" | "captionEn" | "hashtags"
		>
	>;
}): Clip | null {
	const existing = clips.get(clipId);
	if (!existing) return null;

	const updated: Clip = { ...existing, ...patch };
	clips.set(clipId, updated);
	return updated;
}

const RENDER_QUEUE_MS = 800;
const RENDER_DURATION_MS = 5000;

export function startClipRenderFixture({ clipId }: { clipId: string }): Clip | null {
	const existing = clips.get(clipId);
	if (!existing) return null;

	const existingTimers = renderTimers.get(clipId);
	if (existingTimers) {
		existingTimers.forEach((timer) => clearTimeout(timer));
	}

	clips.set(clipId, { ...existing, renderStatus: "queued", previewUrl: null });

	const toRendering = setTimeout(() => {
		const current = clips.get(clipId);
		if (current) clips.set(clipId, { ...current, renderStatus: "rendering" });
	}, RENDER_QUEUE_MS);

	const toReady = setTimeout(() => {
		const current = clips.get(clipId);
		if (current) {
			clips.set(clipId, {
				...current,
				renderStatus: "ready",
				previewUrl: current.sourceVideoUrl,
			});
		}
	}, RENDER_QUEUE_MS + RENDER_DURATION_MS);

	renderTimers.set(clipId, [toRendering, toReady]);

	return clips.get(clipId) ?? null;
}

export function getClipRenderStatusFixture({ clipId }: { clipId: string }): {
	status: RenderStatusValue;
	previewUrl: string | null;
} | null {
	const existing = clips.get(clipId);
	if (!existing) return null;
	return { status: existing.renderStatus, previewUrl: existing.previewUrl };
}
