/**
 * Deterministic per-platform metadata adaptation (mirror of the SPA's
 * frontend/src/lib/platformProfiles.ts). Rewrites a clip's title/description/
 * hashtags to match each platform's algorithm — no LLM, no backend.
 */
export type TargetPlatform = "tiktok" | "reels" | "shorts";

interface PlatformProfile {
	label: string;
	tagPack: string[];
	maxTags: number;
	captionMax: number;
	cta: string;
	titleStyle: "native" | "seo";
}

export const PLATFORMS: TargetPlatform[] = ["tiktok", "reels", "shorts"];

export const PLATFORM_PROFILES: Record<TargetPlatform, PlatformProfile> = {
	tiktok: {
		label: "TikTok",
		tagPack: ["#fyp", "#foryou", "#foryoupage", "#viral"],
		maxTags: 6,
		captionMax: 150,
		cta: "follow for part 2 👀",
		titleStyle: "native",
	},
	reels: {
		label: "Reels",
		tagPack: ["#reels", "#reelsinstagram", "#explore", "#trending"],
		maxTags: 10,
		captionMax: 125,
		cta: "save & share 💾",
		titleStyle: "native",
	},
	shorts: {
		label: "Shorts",
		tagPack: ["#shorts", "#youtubeshorts"],
		maxTags: 4,
		captionMax: 100,
		cta: "subscribe for more",
		titleStyle: "seo",
	},
};

export interface AdaptInput {
	titleNative?: string;
	titleEnglish?: string;
	caption?: string;
	hashtags?: string[];
}

export interface AdaptedMeta {
	title: string;
	description: string;
	hashtags: string[];
}

export function adaptMetadata(
	clip: AdaptInput,
	platform: TargetPlatform,
): AdaptedMeta {
	const p = PLATFORM_PROFILES[platform];
	const title =
		(p.titleStyle === "seo"
			? clip.titleEnglish || clip.titleNative
			: clip.titleNative || clip.titleEnglish) ?? "";

	const base = (clip.caption ?? "").slice(0, p.captionMax).trim();
	const description = base ? `${base}\n\n${p.cta}` : p.cta;

	const seen = new Set<string>();
	const hashtags = [...(clip.hashtags ?? []), ...p.tagPack]
		.filter((tag) => {
			const key = tag.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, p.maxTags);

	return { title, description, hashtags };
}

export function adaptedToText(meta: AdaptedMeta): string {
	return [meta.title, meta.description, meta.hashtags.join(" ")]
		.filter(Boolean)
		.join("\n\n");
}
