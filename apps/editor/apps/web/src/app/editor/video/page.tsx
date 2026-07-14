"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listVideos } from "@/services/highlight-api/client";
import type { Video } from "@/services/highlight-api/schema";

/**
 * Video list: the entry point for the AI Highlight Clip flow (backed by the
 * highlight-api mock, see src/services/highlight-api). Distinct from
 * /projects, which lists local IndexedDB projects (editor-provider.tsx's
 * flow) and remains fully reachable as an offline fallback.
 */
export default function VideoListPage() {
	const [videos, setVideos] = useState<Video[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		listVideos()
			.then((result) => {
				if (!cancelled) setVideos(result);
			})
			.catch((err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to load videos");
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="bg-background min-h-screen">
			<header className="sticky top-0 z-20 px-8 bg-background flex items-center h-16">
				<h1 className="text-base font-medium">Highlight videos</h1>
			</header>
			<main className="mx-auto px-8 pb-6 flex flex-col gap-4">
				{error ? (
					<p className="text-destructive text-sm">{error}</p>
				) : !videos ? (
					<div className="grid grid-cols-1 gap-6 sm:grid-cols-3 lg:grid-cols-4">
						{Array.from({ length: 4 }, (_, i) => (
							<Skeleton key={i} className="aspect-video bg-muted/50" />
						))}
					</div>
				) : videos.length === 0 ? (
					<p className="text-muted-foreground text-sm py-16 text-center">
						No videos yet.
					</p>
				) : (
					<div className="grid grid-cols-1 gap-6 sm:grid-cols-3 lg:grid-cols-4">
						{videos.map((video) => (
							<Link key={video.id} href={`/editor/video/${video.id}`}>
								<Card className="bg-background overflow-hidden border-none p-0">
									<div className="bg-muted relative aspect-video flex items-center justify-center">
										{/* biome-ignore lint/a11y/useMediaCaption: silent muted preview thumbnail */}
										<video src={video.videoUrl} muted className="size-full object-cover" />
									</div>
									<CardContent className="flex flex-col gap-1 px-0 pt-4">
										<h3 className="text-sm font-medium truncate">{video.title}</h3>
										<p className="text-muted-foreground text-xs">
											{Math.round(video.durationSeconds)}s
										</p>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
				)}
			</main>
		</div>
	);
}
