"""Deterministic seeded PRNG utility shared by Analysis_Stage_Stub Lambdas
(Task 11.1).

seed = hash(jobId + "|" + sorted(sourceKeys).join(",") + "|" +
             sorted(targets).join(","))

Re-running the stub stages for the same Job identity (unchanged jobId,
sourceKeys[], targets[]) must produce identical output (Req 6.6, 6.8), so
the seed is derived only from those three immutable fields -- never from
wall-clock time or other non-deterministic input -- and Python's stdlib
`random.Random(seed)` (a deterministic Mersenne Twister) is used instead of
the global `random` module.

Validates: Requirements 6.6, 6.8
"""
import hashlib
import random


def compute_seed(job_id: str, source_keys, targets, purpose: str = "") -> int:
    """`purpose` namespaces the seed per stub stage (e.g. "fusion",
    "categorization") so each stage's Lambda invocation can derive its own
    independent rng from just the Job identity, without needing to replay
    another stage's exact draw sequence to "catch up" -- both stages stay
    deterministic across re-runs (Req 6.6, 6.8) and independent of each
    other's internal implementation details."""
    material = "|".join(
        [
            job_id,
            ",".join(sorted(source_keys)),
            ",".join(sorted(targets)),
            purpose,
        ]
    )
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def seeded_rng(job_id: str, source_keys, targets, purpose: str = "") -> random.Random:
    return random.Random(compute_seed(job_id, source_keys, targets, purpose))
