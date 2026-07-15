"""End-to-end orchestrator: VOD + chat log -> ranked, rendered highlight clips.

Chains the pipeline stages (each also runnable standalone):
  chat signals -> audio extract/upload -> Transcribe -> Rekognition ->
  audio energy -> fusion -> AI Director (Bedrock) -> render

This is the local/demo orchestrator; the cloud deployment maps each stage onto
Step Functions + Lambda (see README architecture).

Usage:
  python3 -m pipeline.run --video data/6910008_video.mp4 --chat-log data/6910008_log.csv \
      --s3-bucket hackathon-152315741309-us-east-1-an --stream-id 6910008
Skip stages whose outputs already exist in --outdir (idempotent, resume-friendly).
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import boto3

REGION = "us-east-1"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class StageTimer:
    """Records a timestamp at the start of each pipeline stage. Non-invasive:
    stages call `mark(name)` and durations are derived from consecutive marks
    (a skipped stage lands next to its neighbour, so it reads as ~zero-length).
    Consumed by pipeline.metrics via out/timings.json."""

    def __init__(self):
        self.marks = []  # list of (name, epoch_seconds)

    def mark(self, name):
        self.marks.append((name, time.time()))


def write_timings(timer, outdir, stream_id=None):
    """Turn stage marks into out/timings.json: {streamId, stages:[{name,startS,endS}]}.
    Each stage ends where the next begins; the last ends at the current time."""
    if not timer.marks:
        return None
    t0 = timer.marks[0][1]
    final = time.time()
    stages = []
    for i, (name, t) in enumerate(timer.marks):
        start = t - t0
        end = (timer.marks[i + 1][1] - t0) if i + 1 < len(timer.marks) else (final - t0)
        stages.append({"name": name, "startS": round(start, 2), "endS": round(max(end, start), 2)})
    doc = {"streamId": stream_id, "stages": stages}
    path = Path(outdir) / "timings.json"
    path.write_text(json.dumps(doc, indent=1))
    return path


def run(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video", required=True)
    ap.add_argument("--chat-log", required=True)
    ap.add_argument("--s3-bucket", required=True)
    ap.add_argument("--stream-id", required=True)
    ap.add_argument("--vertical", default="talk")
    ap.add_argument("--outdir", default="out")
    ap.add_argument("--top-clips", type=int, default=12,
                    help="max highlights to keep/render (more clips = richer "
                         "compilation clustering). Actual count is capped by how "
                         "many candidates the Director marks keep=true.")
    ap.add_argument("--visual-mode", choices=["fast", "full", "off"], default="fast",
                    help="fast: face-detect only candidate windows (default); "
                         "full: whole-VOD Rekognition (4-modal fusion); off: skip visual")
    ap.add_argument("--emit-contracts", dest="emit_contracts", action="store_true", default=True,
                    help="emit canonical clips.json + per-clip EDLs (default on)")
    ap.add_argument("--no-emit-contracts", dest="emit_contracts", action="store_false")
    ap.add_argument("--upload-s3", action="store_true", default=False,
                    help="upload clips/thumbs/proxies/manifest/EDLs to S3 + presign (needs live creds)")
    args = ap.parse_args(argv)

    out = Path(args.outdir)
    out.mkdir(exist_ok=True)
    video = Path(args.video)
    sid = args.stream_id
    timer = StageTimer()

    from pipeline import fusion
    from pipeline.signals import audio as audio_mod
    from pipeline.signals import chat as chat_mod
    from pipeline.signals import transcript as tx_mod
    from pipeline.signals import visual as vis_mod

    # ---- 1. chat signals (instant, local)
    timer.mark("chat")
    chat_json = out / "chat_signals.json"
    if not chat_json.exists():
        log("chat: analyzing event log")
        result = chat_mod.analyze(args.chat_log)
        chat_json.write_text(json.dumps(
            result, ensure_ascii=False,
            default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    log(f"chat: {chat_json}")

    # ---- 2. audio track extract + upload (Transcribe's 2GB limit -> audio-only)
    timer.mark("audio")
    audio_file = video.with_suffix(".m4a")
    if not audio_file.exists():
        log("audio: extracting track from VOD")
        audio_mod.extract_audio(video, audio_file)
    audio_key = f"audio/{audio_file.name}"
    s3 = boto3.client("s3", region_name=REGION)
    try:
        s3.head_object(Bucket=args.s3_bucket, Key=audio_key)
    except Exception:
        log(f"audio: uploading s3://{args.s3_bucket}/{audio_key}")
        s3.upload_file(str(audio_file), args.s3_bucket, audio_key)

    # ---- 3. start async AWS jobs (Transcribe + Rekognition) up front
    timer.mark("aws_jobs_start")
    transcript_json = out / "transcript.json"
    job_name = f"vod-{sid}-{int(audio_file.stat().st_size) % 100000}"
    if not transcript_json.exists():
        try:
            tx_mod.get_job(job_name)
            log(f"transcribe: job {job_name} already exists")
        except Exception:
            log(f"transcribe: starting {job_name}")
            tx_mod.start_job(f"s3://{args.s3_bucket}/{audio_key}", job_name,
                             output_bucket=args.s3_bucket)

    visual_json = out / "visual_signals.json"
    rek_jobs_file = out / f"rek_jobs_{sid}.json"
    if args.visual_mode == "full" and not visual_json.exists():
        if rek_jobs_file.exists():
            rek_jobs = json.loads(rek_jobs_file.read_text())
        else:
            log("rekognition: starting shot+face jobs (full VOD)")
            rek_jobs = vis_mod.start_jobs(f"s3://{args.s3_bucket}/{sid}_video.mp4")
            rek_jobs_file.write_text(json.dumps(rek_jobs))

    # ---- 4. local audio energy while cloud jobs run
    timer.mark("audio_energy")
    audio_json = out / "audio_signals.json"
    if not audio_json.exists():
        log("audio: RMS energy analysis")
        audio_json.write_text(json.dumps(audio_mod.analyze(audio_file)))
    log(f"audio: {audio_json}")

    # ---- 5. collect Transcribe
    timer.mark("transcribe")
    if not transcript_json.exists():
        log("transcribe: waiting for completion")
        job = tx_mod.wait_job(job_name)
        if job["TranscriptionJobStatus"] == "FAILED":
            log(f"transcribe FAILED: {job.get('FailureReason')} (continuing without speech)")
        else:
            parsed = tx_mod.parse_transcript(tx_mod.fetch_result(job))
            transcript_json.write_text(json.dumps(parsed, ensure_ascii=False))
    log(f"transcript: {transcript_json if transcript_json.exists() else 'unavailable'}")

    # ---- 6. collect Rekognition (full mode only; fast mode runs post-fusion)
    if args.visual_mode == "full" and not visual_json.exists():
        log("rekognition: waiting for completion")
        while True:
            s_status, shot_pages = vis_mod.get_shots(rek_jobs["shots"])
            f_status, face_pages = vis_mod.get_faces(rek_jobs["faces"])
            if s_status == "SUCCEEDED" and f_status == "SUCCEEDED":
                visual_json.write_text(json.dumps(vis_mod.parse_results(shot_pages, face_pages)))
                break
            if "FAILED" in (s_status, f_status):
                log("rekognition FAILED (continuing without visual)")
                break
            time.sleep(30)
    log(f"visual: {visual_json if visual_json.exists() else args.visual_mode + ' mode'}")

    # ---- 6.5 auto-align event log with the recording (see pipeline.align)
    from pipeline import align as align_mod

    chat_sig = json.loads(chat_json.read_text())
    audio_sig = json.loads(audio_json.read_text())
    chat_offset, conf = align_mod.estimate_offset(chat_sig, audio_sig)
    log(f"align: chat->video offset {chat_offset:.0f}s (confidence z={conf:.1f})")
    if conf < 1.5:
        log("align: low confidence, falling back to offset 0")
        chat_offset = 0.0

    # ---- 7. fusion
    cands_json = out / "candidates.json"
    fusion_args = ["--chat", str(chat_json), "--audio", str(audio_json),
                   "--chat-offset", str(chat_offset),
                   "--vertical", args.vertical, "--out", str(cands_json)]
    if visual_json.exists():
        # faces-only files from fast mode have no binned series; skip those
        if json.loads(visual_json.read_text())["series"]["t_s"]:
            fusion_args += ["--visual", str(visual_json)]
    if transcript_json.exists():
        fusion_args += ["--transcript", str(transcript_json)]
    timer.mark("fusion")
    log("fusion: building excitement curve + candidates")
    fusion.main(fusion_args)

    # ---- 7.5 fast visual: face-detect ONLY the candidate windows, in parallel,
    # while the Director judges. ~10 min of footage instead of the whole VOD.
    face_jobs = None
    if args.visual_mode == "fast" and not visual_json.exists():
        windows = [(c["start_s"], c["end_s"])
                   for c in json.loads(cands_json.read_text())["candidates"]]
        if windows:
            log(f"rekognition(fast): face jobs on {len(windows)} candidate segments")
            face_jobs = vis_mod.start_face_jobs_for_windows(
                video, args.s3_bucket, windows, out / "segments")

    # ---- 8. AI Director
    hl_json = out / "highlights.json"
    from pipeline import director

    dir_args = [str(cands_json), "--chat-log", args.chat_log,
                "--chat-offset", str(chat_offset),
                "--video", str(video), "--out", str(hl_json)]
    if transcript_json.exists():
        dir_args += ["--transcript", str(transcript_json)]
    timer.mark("director")
    log("director: judging candidates with Bedrock")
    director.main(dir_args)

    if face_jobs:
        log("rekognition(fast): collecting segment face jobs")
        faces = vis_mod.collect_face_jobs(face_jobs)
        visual_json.write_text(json.dumps(
            {"signal": "visual", "bin_seconds": 5,
             "series": {"t_s": [], "scene_change": [], "emotion_hot": []},
             "shots": [], "faces": faces}))
        log(f"visual: {len(faces)} face samples for smart-crop -> {visual_json}")

    # ---- 9. render clips
    from pipeline import render as render_mod

    render_args = [str(hl_json), "--video", str(video),
                   "--outdir", str(out / "clips"), "--top", str(args.top_clips)]
    if transcript_json.exists():
        render_args += ["--transcript", str(transcript_json)]
    if visual_json.exists():
        render_args += ["--visual", str(visual_json)]
    timer.mark("render")
    log("render: cutting vertical clips")
    render_mod.main(render_args)

    # ---- 10. emit contract-shaped artifacts (canonical manifest + per-clip EDLs)
    clips_dir = out / "clips"
    if args.emit_contracts:
        timer.mark("contracts")
        from pipeline import contracts, edl as edl_mod

        log("contracts: emitting canonical clips.json")
        contracts.emit(hl_json, clips_dir / "manifest.json", sid, clips_dir / "clips.json")

        # ---- 10a. cross-clip compilation topics (Bedrock) -> compilations.json
        from pipeline import compilations as comp_mod

        log("compilations: proposing compilation reels with Bedrock")
        try:
            comps = comp_mod.emit(clips_dir / "manifest.json", clips_dir / "compilations.json")
            log(f"  {len(comps)} compilations")
        except Exception as e:  # a compilation failure shouldn't kill the run
            log(f"  compilations skipped: {e}")

        log("edl: emitting per-clip EDLs")
        edl_mod.emit(hl_json, sid, out / "edl",
                     transcript_path=str(transcript_json) if transcript_json.exists() else None,
                     visual_path=str(visual_json) if visual_json.exists() else None,
                     top=args.top_clips)

        # ---- 10b. AI auto-edit: detect reaction zooms, onomatopoeia, SFX
        from pipeline import autoedit as autoedit_mod

        log("autoedit: detecting reaction zooms, onomatopoeia, SFX")
        autoedit_updated = autoedit_mod.emit(
            hl_json, str(args.video), out / "edl",
            transcript_path=str(transcript_json) if transcript_json.exists() else None,
            visual_path=str(visual_json) if visual_json.exists() else None,
            chat_path=str(chat_json) if chat_json.exists() else None,
            top=args.top_clips)
        for clip_id, n_effects in autoedit_updated:
            log(f"  {clip_id}: {n_effects} auto-edit effects")

        # ---- 10c. render burned-in "director's cut" (autoedit effects baked into MP4)
        from pipeline import render_autoedit as render_ae_mod

        log("render_autoedit: burning effects into director's-cut clips")
        ae_rendered = render_ae_mod.emit(out / "edl", out / "clips", out / "clips")
        for clip_id, path in ae_rendered:
            log(f"  {clip_id} -> {path.name}")

    # ---- 11. publish to S3 (presigned GET URLs) — opt-in, needs live creds
    if args.upload_s3:
        from pipeline import publish as publish_mod

        log("publish: uploading artifacts to S3 + presigning")
        publish_mod.publish(sid, out, args.s3_bucket)

    # ---- 12. generate demo gallery HTML
    from pipeline import gallery as gallery_mod

    log("gallery: generating HTML preview")
    gallery_args = [str(out / "clips"), "--stream-id", sid,
                    "--out", str(out / "clips" / "gallery.html")]
    metrics_json = out / "metrics.json"
    if metrics_json.exists():
        gallery_args += ["--metrics", str(metrics_json)]
    gallery_mod.main(gallery_args)

    # ---- stage timings for the metrics aggregator (pipeline.metrics)
    timings_path = write_timings(timer, out, sid)
    if timings_path:
        log(f"timings: {timings_path}")

    log("DONE")


if __name__ == "__main__":
    sys.exit(run())
