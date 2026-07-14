# StreamSmith — AI Highlight Clips from Livestream VODs · Proposal Briefing (提案簡報)

Created by The Waymakers: Jason Nishio, Nelson Nishio, Aaron Lin

## (Delete later): Master Info Doc
https://docs.google.com/document/d/1U9w-FqNHhfgTD3M4OqbhWIHJUrrAoLOEVO5DSZ_FU6s/edit?tab=t.8co3t9wtql91 

## 1. Solution Overview
Streamers produce hours of live content, but short-form platforms (TikTok / IG Reels / YouTube Shorts) are where audiences grow. Manually reviewing a 2-hour VOD to cut 5 vertical clips takes an editor half a day. **StreamSmith ingests a livestream VOD plus its platform event log and automatically produces ranked, captioned, 9:16 highlight clips with platform-ready titles and hashtags — in minutes, for dollars.**

Key idea: a highlight is a *cross-modal agreement event* — the chat erupts, the audio peaks, and the scene reacts at the same moment. We fuse engagement, audio/speech, and visual signals into one excitement curve, then a **Bedrock "AI Director"** turns statistical peaks into narrative clips (setup → payoff) with publish-ready metadata in 中文 + English.

## 2. Three-module Design (三模組設計)

1) **Intelligent content analysis: highlight detection logic and multimodal fusion strategy**
    - **Engagement signal (unique data advantage)**: parse the platform event log (chat text, sender VIP/user level, joins, moderator flags). Features per 5-second bin: chat-rate z-score, unique chatters, join surges, laughter/slang bursts (哈哈哈, 笑死, 666), **VIP-weighted message value** (a whale reacting ≠ a lurker spamming), and **template-spam suppression** (novelty weighting kills copy-paste fan promos).
    - **Audio + speech**: Amazon Transcribe (zh-TW, word-level timestamps, speaker labels) for what was said; ffmpeg RMS loudness + onset detection for how loudly it was said (screams, crowd pops, song climaxes).
    - **Visual**: Rekognition Video shot-segment detection (scene-change density + clean cut points) and face detection with emotions (SURPRISED/HAPPY spikes; bounding boxes reused for smart cropping).
    - **Fusion**: all signals resampled to a common 5s grid, z-normalized, combined with per-vertical weights (talk show vs gaming presets). **Cross-modal validation** — a candidate survives only if ≥2 modalities spike together. **AI Director (Bedrock Claude)** then judges each candidate with transcript + chat + keyframes: confirms clip-worthiness, extends boundaries to capture the narrative arc, assigns a virality score and mood label.

2) **AI automatic editing engine: cropping, splicing and narrative structure generation**
    - Clip boundaries chosen by the AI Director for setup → payoff, snapped near Rekognition shot boundaries.
    - 16:9 → 9:16 **face-guided smart crop**: crop window panned to the median face position from Rekognition face tracking.
    - Burned-in zh captions generated from Transcribe word timestamps (ASS subtitle pipeline).
    - Hook overlay: the Director's ≤12-character hook line rendered over the first 2.5 seconds.

3) **Multi-style content production: platform adaptation (TikTok / IG Reels / YouTube Shorts)**
    - Per-clip metadata pack from Bedrock: title, hook, caption, hashtags — Traditional Chinese + English.
    - Platform presets: clip length targets, caption style, hook placement; MediaConvert job templates render the delivery variants at scale.
    - Ranked output: clips sorted by virality score so creators publish the best first.

## 3. User flow (使用者流程)
1. Creator (or agency) uploads a VOD + event log — or points StreamSmith at the platform's storage bucket.
2. Pipeline runs automatically (~15 min for a 90-min VOD): signals → fusion → AI Director → render.
3. Creator opens the gallery: ranked clips with virality scores, moods, captions, hashtags.
4. One-click download / publish per platform; optional weight presets per content vertical (talk / gaming).

## 4. Output Demonstration & Interface Design (產出展示與介面設計)
- Demo on a real 96-minute langlive idol-show VOD (`6910008`): excitement curve visualization with detected windows, then the top-5 rendered 9:16 clips with captions + hooks.
- Detected moments (validated against chat content): performer entrance (27:25), song performance peak (62:35), joke landing with 🤣 wall (45:00), prize announcement (83:45).
- Interface: web gallery — upload panel, pipeline progress, excitement-curve explorer, clip cards (preview, score, mood, copy-paste captions).

## 5. AWS Deployment Architecture (AWS 部署架構設計圖)
AWS Services Usage Overview:

| Service | Role |
|---|---|
| **S3** | VOD + event-log landing zone; clip + manifest delivery |
| **EventBridge** | upload event triggers the pipeline |
| **Step Functions** | orchestrates the stage graph below (parallel signal extraction) |
| **Lambda** | chat-log parsing, signal fusion, job glue (ffmpeg via container image) |
| **Amazon Transcribe** | zh-TW speech-to-text, word timestamps, speaker labels, SRT/VTT sidecars |
| **Amazon Rekognition Video** | shot segments, face detection + emotions (smart-crop input) |
| **Amazon Bedrock (Claude / Nova)** | chat-burst mood classification, semantic transcript scan, AI Director judging + metadata generation (multimodal: keyframes) |
| **MediaConvert** | clip cutting, 9:16 transforms, delivery renditions |
| **DynamoDB** | job state + clip manifests |
| **CloudFront + S3/Amplify** | gallery frontend + clip delivery |

```
VOD+log ─► S3 ─► EventBridge ─► Step Functions
                                   ├─(parallel)─ Lambda: chat signals
                                   ├─(parallel)─ Transcribe (audio track)
                                   ├─(parallel)─ Rekognition: shots+faces
                                   ├─(parallel)─ Lambda: audio RMS energy
                                   ├─ Lambda: multimodal fusion ─► candidates
                                   ├─ Bedrock: AI Director ─► highlight manifest
                                   ├─ MediaConvert: 9:16 renders ─► S3 clips
                                   └─ DynamoDB manifest ─► CloudFront gallery
```
Scalability: every stage is a stateless job on managed services — N VODs fan out to N parallel state-machine executions; Rekognition/Transcribe/MediaConvert scale per-job; Bedrock throughput scales with on-demand model invocation. Live-ready roadmap: IVS/MediaLive HLS segments feed the same pipeline over rolling 5-minute windows for near-real-time clipping.

## 6. Performance Evaluation (成效衡量)
- **Detection precision**: top-5 clips judged highlight-worthy by a human vs the streamer's own picks (target ≥ 4/5). Cross-modal validation eliminated 100% of chat-template spam false positives on the demo VOD.
- **Speed**: ~90-min VOD → clips in ≈15 min wall-clock (stages parallelized).
- **Cost per VOD** (96 min): Transcribe ≈ $2.3, Rekognition shots+faces ≈ $14, Bedrock Director ≈ $0.3, MediaConvert ≈ $1 → **< $20 per VOD**, vs. hours of editor time.
- **Commercial applicability**: per-VOD SaaS pricing for creators/agencies; platform-side integration (langlive already stores VOD + event logs — zero-friction data source); highlight metadata doubles as content-moderation and engagement analytics.
