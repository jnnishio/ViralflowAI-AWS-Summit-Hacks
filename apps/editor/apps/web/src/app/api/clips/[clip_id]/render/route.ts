import { NextResponse } from "next/server";
import { startClipRenderFixture } from "@/services/highlight-api/fixtures";

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ clip_id: string }> },
) {
	const { clip_id } = await params;
	const updated = startClipRenderFixture({ clipId: clip_id });
	if (!updated) {
		return NextResponse.json({ error: "Clip not found" }, { status: 404 });
	}

	return NextResponse.json(updated);
}
