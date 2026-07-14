"use client";

import { useParams } from "next/navigation";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { ClipMetadataPanel } from "@/components/editor/panels/clip-metadata";
import { Timeline } from "@/timeline/components";
import { PreviewPanel } from "@/preview/components";
import { VideoEditorHeader } from "@/components/editor/video-editor-header";
import { VideoEditorProvider } from "@/components/providers/video-editor-provider";
import { MobileGate } from "@/components/editor/mobile-gate";
import { usePanelStore } from "@/editor/panel-store";

/**
 * The multi-clip editor: opens all of a video's clips as scenes (see
 * remote-clips-manager.ts), pre-selecting the clip the user clicked "Open in
 * Editor" on from the clips gallery (../../page.tsx). Scene tabs in
 * VideoEditorHeader still let you switch between the video's other clips
 * without leaving the editor.
 */
export default function VideoEditorPage() {
	const params = useParams();
	const videoId = params.video_id as string;
	const clipId = params.clip_id as string;

	return (
		<MobileGate>
			<VideoEditorProvider videoId={videoId} initialClipId={clipId}>
				<div className="bg-background flex h-screen w-screen flex-col overflow-hidden">
					<VideoEditorHeader />
					<div className="min-h-0 min-w-0 flex-1">
						<VideoEditorLayout />
					</div>
				</div>
			</VideoEditorProvider>
		</MobileGate>
	);
}

function VideoEditorLayout() {
	const { panels, setPanel } = usePanelStore();

	return (
		<ResizablePanelGroup
			direction="vertical"
			className="size-full gap-[0.18rem]"
			onLayout={(sizes) => {
				setPanel({ panel: "mainContent", size: sizes[0] ?? panels.mainContent });
				setPanel({ panel: "timeline", size: sizes[1] ?? panels.timeline });
			}}
		>
			<ResizablePanel
				defaultSize={panels.mainContent}
				minSize={30}
				maxSize={85}
				className="min-h-0"
			>
				<ResizablePanelGroup
					direction="horizontal"
					className="size-full gap-[0.19rem] px-3"
					onLayout={(sizes) => {
						setPanel({ panel: "tools", size: sizes[0] ?? panels.tools });
						setPanel({ panel: "preview", size: sizes[1] ?? panels.preview });
						setPanel({ panel: "properties", size: sizes[2] ?? panels.properties });
					}}
				>
					<ResizablePanel
						defaultSize={panels.tools}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						<AssetsPanel />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={panels.preview}
						minSize={30}
						className="min-h-0 min-w-0 flex-1"
					>
						<PreviewPanel overlayControls={[]} overlayInstances={[]} onOverlayVisibilityChange={() => {}} />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={panels.properties}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						<PropertiesPanel />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel defaultSize={22} minSize={15} maxSize={40} className="min-w-0">
						<ClipMetadataPanel />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>

			<ResizableHandle withHandle />

			<ResizablePanel
				defaultSize={panels.timeline}
				minSize={15}
				maxSize={70}
				className="min-h-0 px-3 pb-3"
			>
				<Timeline />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
