#!/usr/bin/env bash
# Doctor review flow (WP 2.3 — spec §7.4). A pending row `fur-seed-1` is
# pre-seeded for patient-1 with doctor-1 assigned (see harness/seed.ts).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${DIR}/_lib.sh"

echo "### DOSE / DOCTOR-REVIEW DOMAIN ###"

REVIEW='{"doctorPrescribedDoses":{"neoral_tac":"1.5/1.5","pred":"5"},"clinicalNotes":"reduce tac","nextFollowupIntervalDays":14,"doseChangeReason":"tac level trending high"}'

check "doctor submits a review for pending row -> 200" \
  200 PUT "/followup/rows/fur-seed-1/response" "$TOK_DOCTOR" "$REVIEW"

check "patient cannot submit a review -> 403" \
  403 PUT "/followup/rows/fur-seed-1/response" "$TOK_PATIENT" "$REVIEW"

check "review for unknown row -> 404" \
  404 PUT "/followup/rows/does-not-exist/response" "$TOK_DOCTOR" "$REVIEW"

check "patient reads the doctor response -> 200" \
  200 GET "/followup/rows/fur-seed-1/response" "$TOK_PATIENT"

check "patient reads dose-change history -> 200" \
  200 GET "/followup/rows/fur-seed-1/dose-changes" "$TOK_PATIENT"

check "unauthenticated review rejected -> 401" \
  401 PUT "/followup/rows/fur-seed-1/response" "" "$REVIEW"

summary
