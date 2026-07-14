import type { SnapPoint } from "@/timeline/snapping";
import type { ShotBoundary } from "@/services/highlight-api/schema";
import { mediaTimeFromSeconds } from "@/wasm";

/**
 * Rekognition shot-segment boundaries (pipeline/signals/visual.py) for the
 * currently loaded VOD, exposed as trim-handle snap points. Modeled directly
 * on timeline/bookmarks/snap-source.ts — same shape, but externally-driven
 * (from the AI Highlight backend) rather than user-created.
 */
export function getShotBoundarySnapPoints({
	shots,
}: {
	shots: ShotBoundary[];
}): SnapPoint[] {
	return shots.flatMap((shot) => [
		{
			time: mediaTimeFromSeconds({ seconds: shot.start }),
			type: "shot-boundary" satisfies SnapPoint["type"],
		},
		{
			time: mediaTimeFromSeconds({ seconds: shot.end }),
			type: "shot-boundary" satisfies SnapPoint["type"],
		},
	]);
}
