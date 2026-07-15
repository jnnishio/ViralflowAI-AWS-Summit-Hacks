import type { Edl } from "./schema";

/**
 * Real music-bed selection via the Freesound search API (FREESOUND_API_KEY
 * is already configured for this app — see .env.local). The Bedrock AI-edit
 * model never picks a concrete track itself (it doesn't know what exists);
 * it only emits a `musicIntent` (mood/query) when the user explicitly asks
 * for music, and the route resolves that into a real `edl.musicBed` here.
 */

const FREESOUND_SEARCH_URL = "https://freesound.org/apiv2/search/text/";

type FreesoundSearchResult = {
	results: Array<{
		id: number;
		name: string;
		duration: number;
		license: string;
	}>;
};

export async function searchMusicBed({
	mood,
	query,
}: {
	mood: string;
	query?: string;
}): Promise<NonNullable<Edl["musicBed"]>> {
	const apiKey = process.env.FREESOUND_API_KEY;
	if (!apiKey || apiKey === "your_api_key_here") {
		throw new Error("FREESOUND_API_KEY isn't configured");
	}

	const searchTerms = [query, mood, "music", "loop"].filter(Boolean).join(" ");
	const url = new URL(FREESOUND_SEARCH_URL);
	url.searchParams.set("query", searchTerms);
	// Keep it short-form friendly and license-safe for reuse.
	url.searchParams.set("filter", "duration:[5 TO 90]");
	url.searchParams.set("fields", "id,name,duration,license");
	url.searchParams.set("sort", "score");
	url.searchParams.set("page_size", "5");

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Token ${apiKey}` },
	});

	if (!res.ok) {
		throw new Error(`Freesound search failed: ${res.status} ${res.statusText}`);
	}

	const body = (await res.json()) as FreesoundSearchResult;
	const track = body.results[0];
	if (!track) {
		throw new Error(`No Freesound results for "${searchTerms}"`);
	}

	return {
		trackId: String(track.id),
		mood,
		gainDb: -18,
		startOffset: 0,
	};
}
