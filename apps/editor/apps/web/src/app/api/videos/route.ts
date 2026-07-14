import { NextResponse } from "next/server";
import { listVideosFixture } from "@/services/highlight-api/fixtures";

export async function GET() {
	return NextResponse.json(listVideosFixture());
}
