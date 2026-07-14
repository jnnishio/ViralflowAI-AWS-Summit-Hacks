import { NextResponse } from "next/server";
import { getVideoClipsFixture } from "@/services/highlight-api/fixtures";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ video_id: string }> },
) {
	const { video_id } = await params;
	return NextResponse.json(getVideoClipsFixture({ videoId: video_id }));
}
