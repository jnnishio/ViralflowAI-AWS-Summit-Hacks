import { NextResponse } from "next/server";
import { getClipRenderStatusFixture } from "@/services/highlight-api/fixtures";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ clip_id: string }> },
) {
	const { clip_id } = await params;
	const status = getClipRenderStatusFixture({ clipId: clip_id });
	if (!status) {
		return NextResponse.json({ error: "Clip not found" }, { status: 404 });
	}

	return NextResponse.json(status);
}
