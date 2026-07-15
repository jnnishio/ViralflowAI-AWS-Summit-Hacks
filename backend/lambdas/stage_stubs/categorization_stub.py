"""CategorizationStub Analysis_Stage_Stub Lambda (Task 11.6).

Assigns each Clip a `mood` from config/moods.json via an independently
seeded rng (Req 6.6, 6.8), and a `momentType` from a small fixed
placeholder-phrase list. If clipCount >= 2 and only one distinct mood was
picked, force-reassigns one Clip to a different configured mood so >=2
distinct moods are always represented (Req 6.4, 6.5).

Validates: Requirements 6.4, 6.5 (Property 13, 14)
"""
import json
from pathlib import Path

from lambdas.common.ddb import clip_table
from lambdas.common.prng import seeded_rng
from lambdas.progress_api.push import publish_progress_event

STAGE_NAME = "categorization"

MOMENT_TYPE_PHRASES = [
    "song performance",
    "guest story & song reveal",
    "banter with chat",
    "surprise reaction",
    "game highlight",
    "audience shoutout",
]

_MOODS_CACHE = None


def _load_moods() -> list[str]:
    global _MOODS_CACHE
    if _MOODS_CACHE is None:
        config_path = (
            Path(__file__).resolve().parents[3] / "config" / "moods.json"
        )
        data = json.loads(config_path.read_text(encoding="utf-8"))
        _MOODS_CACHE = data["moods"]
    return _MOODS_CACHE


def handler(event, context):  # noqa: ARG001
    job_id = event["jobId"]
    source_keys = event.get("sourceKeys", [])
    targets = event.get("targets", [])
    clip_ids = event.get("clipIds", [])

    publish_progress_event(job_id, STAGE_NAME, "started")

    moods = _load_moods()
    # Independent rng namespaced by purpose="categorization" -- deterministic
    # per Job identity (Req 6.6, 6.8) without needing to replay
    # FusionScoringStub's internal draw sequence.
    rng = seeded_rng(job_id, source_keys, targets, purpose="categorization")

    assignments = {}
    for clip_id in clip_ids:
        assignments[clip_id] = {
            "mood": rng.choice(moods),
            "momentType": rng.choice(MOMENT_TYPE_PHRASES),
        }

    if len(clip_ids) >= 2 and len({a["mood"] for a in assignments.values()}) < 2:
        first_clip_id = clip_ids[0]
        current_mood = assignments[first_clip_id]["mood"]
        alternatives = [m for m in moods if m != current_mood]
        assignments[first_clip_id]["mood"] = rng.choice(alternatives)

    table = clip_table()
    for clip_id, assignment in assignments.items():
        table.update_item(
            Key={"jobId": job_id, "clipId": clip_id},
            UpdateExpression="SET mood = :mood, momentType = :momentType",
            ExpressionAttributeValues={
                ":mood": assignment["mood"],
                ":momentType": assignment["momentType"],
            },
        )

    publish_progress_event(job_id, STAGE_NAME, "completed")

    return event
