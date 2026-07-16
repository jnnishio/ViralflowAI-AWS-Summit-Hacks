import {
	type AiEditRequest,
	type AiEditResponse,
	type Clip,
	type ClipPatch,
	type RenderStatusResponse,
	type Video,
	type VideoClipsResponse,
	aiEditResponseSchema,
	clipSchema,
	renderStatusResponseSchema,
	videoClipsResponseSchema,
	videoSchema,
} from "./schema";
import { z } from "zod";

/**
 * Client for the AI Highlight Clip backend. Defaults to same-origin mock
 * routes under /api (src/app/api/videos, src/app/api/clips) — see
 * src/env/web.ts's NEXT_PUBLIC_BACKEND_API_URL for pointing this at a real
 * deployed API Gateway later without touching call sites.
 */

function getApiBaseUrl(): string {
	return process.env.NEXT_PUBLIC_BACKEND_API_URL ?? "/api";
}

async function apiFetch<T>({
	path,
	schema,
	init,
}: {
	path: string;
	schema: z.ZodType<T>;
	init?: RequestInit;
}): Promise<T> {
	const res = await fetch(`${getApiBaseUrl()}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init?.headers },
	});

	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(
			(body && typeof body === "object" && "error" in body
				? String((body as { error: unknown }).error)
				: null) ?? `Request failed: ${res.status} ${res.statusText}`,
		);
	}

	const json = await res.json();
	return schema.parse(json);
}

export async function listVideos(): Promise<Video[]> {
	return apiFetch({ path: "/videos", schema: z.array(videoSchema) });
}

export async function getVideoClips({
	videoId,
}: {
	videoId: string;
}): Promise<VideoClipsResponse> {
	return apiFetch({
		path: `/videos/${videoId}/clips`,
		schema: videoClipsResponseSchema,
	});
}

export async function updateClip({
	clipId,
	patch,
}: {
	clipId: string;
	patch: ClipPatch;
}): Promise<Clip> {
	return apiFetch({
		path: `/clips/${clipId}`,
		schema: clipSchema,
		init: { method: "PATCH", body: JSON.stringify(patch) },
	});
}

export async function startClipRender({
	clipId,
}: {
	clipId: string;
}): Promise<Clip> {
	return apiFetch({
		path: `/clips/${clipId}/render`,
		schema: clipSchema,
		init: { method: "POST" },
	});
}

export async function getClipRenderStatus({
	clipId,
}: {
	clipId: string;
}): Promise<RenderStatusResponse> {
	return apiFetch({
		path: `/clips/${clipId}/status`,
		schema: renderStatusResponseSchema,
	});
}

/**
 * Burn TikTok-style karaoke captions onto this clip on the server, reusing the
 * pipeline's word-level Transcribe timings (see pipeline/caption_burn.py).
 * Returns a previewUrl for the captioned MP4. Applied on demand from the
 * editor's "Auto Caption" button rather than baked into the highlights grid,
 * so the creator keeps full editing control (e.g. skip captions on singing
 * clips where Transcribe struggles).
 */
export async function applyClipCaptions({
	clipId,
}: {
	clipId: string;
}): Promise<RenderStatusResponse> {
	return apiFetch({
		path: `/clips/${clipId}/apply-captions`,
		schema: renderStatusResponseSchema,
		init: { method: "POST" },
	});
}

export async function requestAiEdit({
	clipId,
	request,
}: {
	clipId: string;
	request: AiEditRequest;
}): Promise<AiEditResponse> {
	return apiFetch({
		path: `/clips/${clipId}/ai-edit`,
		schema: aiEditResponseSchema,
		init: { method: "POST", body: JSON.stringify(request) },
	});
}
