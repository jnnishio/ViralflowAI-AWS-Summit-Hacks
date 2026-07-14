"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getVideoClips, listVideos } from "@/services/highlight-api/client";
import type { Clip, Video } from "@/services/highlight-api/schema";

type SortOrder = "desc" | "asc";

/**
 * Clips gallery for one video: browse/compare the AI-detected highlights
 * before committing to edit one (see remote-clips-manager.ts for how a click
 * on "Open in Editor" loads that clip into the multi-clip editor). Mirrors
 * the "Highlights_Grid" concept from .kiro/steering/architecture.md — score,
 * mood/category, hook, hashtags per card, sortable by score.
 */
export default function ClipsGalleryPage() {
	const params = useParams();
	const videoId = params.video_id as string;

	const [video, setVideo] = useState<Video | null>(null);
	const [clips, setClips] = useState<Clip[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	useEffect(() => {
		let cancelled = false;

		Promise.all([listVideos(), getVideoClips({ videoId })])
			.then(([videos, { clips: fetchedClips }]) => {
				if (cancelled) return;
				setVideo(videos.find((candidate) => candidate.id === videoId) ?? null);
				setClips(fetchedClips);
			})
			.catch((err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to load clips");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [videoId]);

	const sortedClips = clips
		? [...clips].sort((a, b) => (sortOrder === "desc" ? b.score - a.score : a.score - b.score))
		: null;

	return (
		<div className="bg-background min-h-screen">
			<header className="sticky top-0 z-20 px-8 bg-background flex items-center justify-between h-16">
				<div className="flex items-center gap-3 min-w-0">
					<Link href="/editor/video" className="text-xs text-muted-foreground shrink-0">
						← Videos
					</Link>
					<h1 className="text-base font-medium truncate">
						{video?.title ?? "Highlights"}
					</h1>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setSortOrder((order) => (order === "desc" ? "asc" : "desc"))}
				>
					Score: {sortOrder === "desc" ? "High to low" : "Low to high"}
				</Button>
			</header>
			<main className="mx-auto px-8 pb-6 flex flex-col gap-4">
				{error ? (
					<p className="text-destructive text-sm">{error}</p>
				) : !sortedClips ? (
					<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{Array.from({ length: 4 }, (_, i) => (
							<Skeleton key={i} className="aspect-video bg-muted/50" />
						))}
					</div>
				) : sortedClips.length === 0 ? (
					<p className="text-muted-foreground text-sm py-16 text-center">
						No highlights detected for this video yet.
					</p>
				) : (
					<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{sortedClips.map((clip) => (
							<ClipCard key={clip.id} clip={clip} videoId={videoId} videoUrl={video?.videoUrl} />
						))}
					</div>
				)}
			</main>
		</div>
	);
}

function ClipCard({
	clip,
	videoId,
	videoUrl,
}: {
	clip: Clip;
	videoId: string;
	videoUrl: string | undefined;
}) {
	return (
		<Card className="bg-background overflow-hidden border-none p-0">
			<div className="bg-muted relative aspect-video">
				{videoUrl && (
					// biome-ignore lint/a11y/useMediaCaption: silent seeked preview, no thumbnail render pipeline exists yet
					<video
						src={`${videoUrl}#t=${clip.start}`}
						muted
						preload="metadata"
						className="size-full object-cover"
					/>
				)}
				<div className="absolute top-2 left-2 flex items-center gap-1">
					<Badge>🔥 {clip.score}</Badge>
					<Badge variant="secondary">{clip.mood}</Badge>
				</div>
				<div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs font-semibold px-2 py-1 rounded-sm">
					{Math.round(clip.end - clip.start)}s
				</div>
			</div>

			<CardContent className="flex flex-col gap-2 px-0 pt-4">
				<h3 className="text-sm font-medium truncate">{clip.hook}</h3>
				<p className="text-muted-foreground text-xs line-clamp-2">{clip.caption}</p>
				<div className="flex flex-wrap gap-1">
					<Badge variant="outline" className="text-xs">
						{clip.category}
					</Badge>
					{clip.hashtags.slice(0, 3).map((tag) => (
						<Badge key={tag} variant="outline" className="text-xs">
							{tag}
						</Badge>
					))}
				</div>
				<Link href={`/editor/video/${videoId}/edit/${clip.id}`}>
					<Button size="sm" className="w-full mt-1">
						Open in Editor
					</Button>
				</Link>
			</CardContent>
		</Card>
	);
}
