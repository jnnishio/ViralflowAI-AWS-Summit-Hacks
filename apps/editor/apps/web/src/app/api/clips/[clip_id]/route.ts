import { NextResponse } from "next/server";
import { clipPatchSchema } from "@/services/highlight-api/schema";
import { patchClipFixture } from "@/services/highlight-api/fixtures";

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ clip_id: string }> },
) {
	const { clip_id } = await params;
	const body = await request.json().catch(() => null);
	const result = clipPatchSchema.safeParse(body);

	if (!result.success) {
		return NextResponse.json(
			{ error: "Invalid clip patch", details: result.error.flatten().fieldErrors },
			{ status: 400 },
		);
	}

	const updated = patchClipFixture({ clipId: clip_id, patch: result.data });
	if (!updated) {
		return NextResponse.json({ error: "Clip not found" }, { status: 404 });
	}

	return NextResponse.json(updated);
}
