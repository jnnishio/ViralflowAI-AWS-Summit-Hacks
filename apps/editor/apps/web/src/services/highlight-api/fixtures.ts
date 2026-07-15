import type { Clip, RenderStatusValue, ShotBoundary, Video } from "./schema";

/**
 * In-memory mock of the AI Highlight Clip backend. Stands in for the
 * (not-yet-built) API Gateway + Lambda + DynamoDB stack described in
 * INTEGRATION_CONTRACT.md. Text content (hook/caption/hashtags/mood/
 * category/score) is copied verbatim from the real pipeline run's
 * out/clips/clips.json, in the same order as out/clips/gallery.html's
 * cards, so gallery.html's "Open in Editor" buttons (clip_01..clip_05) open
 * an editor session whose clip metadata matches what the card shows.
 *
 * Unlike the earlier (video_6910008) fixture set, these clips are the
 * REAL per-clip renders cut by pipeline/render.py from the actual VOD
 * (D:\...\s3-backup\3654414_video.mp4) — each clip's proxy.mp4 was copied
 * into public/sample-videos/ verbatim, so start=0/end=<clip duration> are
 * real trim offsets into that clip's own footage, not placeholder values.
 * hookEn has no pipeline equivalent (the AI Director only emits hook_zh);
 * it's a short hand-written English gloss of hook_zh for the mock UI.
 *
 * Server-process-lifetime only — resets on restart. That's fine for a mock;
 * swapping this module for real HTTP calls to AWS is the intended next step.
 */

const VIDEO_ID = "video_3654414";

// Same-origin (public/sample-videos) so RemoteClipsManager.loadVideo's
// fetch()-as-blob doesn't hit cross-origin CORS blocks. Real durations
// (not round numbers) since these are the actual rendered clip lengths.
const SAMPLE_CLIPS = [
	{ id: "clip_01", file: "3654414_clip_01.mp4", durationSeconds: 35 },
	{ id: "clip_02", file: "3654414_clip_02.mp4", durationSeconds: 60 },
	{ id: "clip_03", file: "3654414_clip_03.mp4", durationSeconds: 58 },
	{ id: "clip_04", file: "3654414_clip_04.mp4", durationSeconds: 60 },
	{ id: "clip_05", file: "3654414_clip_05.mp4", durationSeconds: 58 },
] as const;

// No shot-detection data for this run (visual-mode=fast only ran
// face-detection on candidate windows, not full-VOD shot boundaries) — one
// evenly-split placeholder shot per quarter of the clip's real duration.
function evenShots(durationSeconds: number): ShotBoundary[] {
	const step = durationSeconds / 4;
	return [0, 1, 2, 3].map((i) => ({
		start: i * step,
		end: (i + 1) * step,
		confidence: 95,
	}));
}

const video: Video = {
	id: VIDEO_ID,
	title: "TPE48 zongzi-tasting & games livestream VOD (3654414)",
	videoUrl: `/sample-videos/${SAMPLE_CLIPS[0].file}`,
	mediaAssetId: "media_3654414_overview",
	durationSeconds: SAMPLE_CLIPS[0].durationSeconds,
	createdAt: new Date().toISOString(),
};

const clips = new Map<string, Clip>(
	[
		{
			id: "clip_01",
			videoId: VIDEO_ID,
			score: 78,
			category: "funny moment",
			mood: "funny",
			hook: "排練無聊跳起來😂",
			hookEn: "Bored at rehearsal, starts dancing",
			caption:
				"排練唱歌太無聊，直接自己跳舞找樂子😂 女團路過鏡子全員必停下來整理儀容，這個魔力太真實了吧！",
			captionEn:
				"Too bored at concert rehearsals so she just… started dancing 😂 And apparently every girl group member is physically unable to walk past a mirror without stopping — too relatable!",
			hashtags: [
				"#女團日常",
				"#排練花絮",
				"#鏡子魔力",
				"#直播精華",
				"#girlgroup",
				"#rehearsal",
				"#funny",
				"#台灣女團",
			],
		},
		{
			id: "clip_02",
			videoId: VIDEO_ID,
			score: 72,
			category: "food reaction",
			mood: "funny",
			hook: "減重粽是什麼👀",
			hookEn: "What's a 'diet zongzi'?",
			caption: "第一次挑戰減重粽，說好沒味道要沾糖，結果忘記沾😂表情管理完全失敗，觀眾全都看穿了哈哈哈！",
			captionEn:
				"First time trying a 'diet zongzi' — no filling, no seasoning, supposed to dip in sugar… but she forgot 😂 Facial expressions said it all!",
			hashtags: [
				"#減重粽",
				"#端午節",
				"#試吃反應",
				"#表情管理失敗",
				"#foodreaction",
				"#台灣美食",
				"#直播精華",
			],
		},
		{
			id: "clip_03",
			videoId: VIDEO_ID,
			score: 72,
			category: "food reaction",
			mood: "funny",
			hook: "粽子裡有香菜？！",
			hookEn: "Cilantro... in a rice dumpling?!",
			caption: "香菜花生冰心粽登場💀 打開的瞬間全員崩潰，哥直接說「太好了，那就是你的！」😂 你敢吃嗎？",
			captionEn:
				"A cilantro & peanut ice-filled rice dumpling appears and the whole crew loses it 😂 Would YOU eat this?",
			hashtags: ["#香菜", "#粽子", "#端午節", "#食物挑戰", "#FoodChallenge", "#搞笑", "#台灣美食"],
		},
		{
			id: "clip_04",
			videoId: VIDEO_ID,
			score: 72,
			category: "funny moment",
			mood: "funny",
			hook: "假哭獲勝術😱",
			hookEn: "The fake-cry power move",
			caption:
				"「誰會在吵架時假哭來獲得優勢？」成員互相指認超好笑，還有人65歲被要求點兒童餐😂 這題太犀利了！",
			captionEn:
				"'Who fake-cries during arguments to gain the upper hand?' Members immediately start pointing fingers — and then someone gets roasted for looking young enough to order a kids' meal at 65 😂",
			hashtags: [
				"#假哭",
				"#吵架技巧",
				"#成員互揭",
				"#直播精華",
				"#funnymoment",
				"#台灣直播",
				"#兒童餐",
			],
		},
		{
			id: "clip_05",
			videoId: VIDEO_ID,
			score: 72,
			category: "funny moment",
			mood: "funny",
			hook: "浣熊當貓養🦝",
			hookEn: "Raised a raccoon... as a cat?",
			caption: "這題太荒唐了吧！貓過敏還要帶浣熊回家？笑死😂 #猜猜我是誰",
			captionEn:
				"The most chaotic 'who would' question ever — raccoon as a pet cat?? 😂 The laughter says it all.",
			hashtags: ["#浣熊", "#好笑瞬間", "#直播精華", "#猜猜我是誰", "#funnymoment", "#livestream", "#台灣直播"],
		},
	].map((entry, index) => {
		const sample = SAMPLE_CLIPS[index];
		const clip: Clip = {
			...entry,
			sourceVideoUrl: `/sample-videos/${sample.file}`,
			start: 0,
			end: sample.durationSeconds,
			shots: evenShots(sample.durationSeconds),
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
