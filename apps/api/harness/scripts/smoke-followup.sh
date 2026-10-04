#!/usr/bin/env bash
# Follow-up row submit flow (WP 2.2). Creates a draft, then submits it.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${DIR}/_lib.sh"

echo "### FOLLOWUP DOMAIN ###"

# Create a draft row as the patient (engagement hospital required, §7.2.1).
DRAFT='{"ppDate":"2026-09-10","engagementHospitalId":"hosp-1","labValues":{"hb":10.2,"tlc":5.4,"creatinine":0.6},"drugLevels":{"tac_level":8.1},"patientReportedDoses":{"neoral_tac":"2/2","pred":"5"},"weightKg":14.5,"notes":"feeling well"}'
check "patient creates a draft follow-up row -> 201" \
  201 POST "/followup/rows" "$TOK_PATIENT" "$DRAFT"

check "create rejected without engagementHospitalId -> 400" \
  400 POST "/followup/rows" "$TOK_PATIENT" \
  '{"ppDate":"2026-09-11","labValues":{"hb":10}}'

# Capture the created row id to submit it.
ROW_ID="$(curl -s -X POST "${BASE_URL}/followup/rows" \
  -H "Authorization: Bearer ${TOK_PATIENT}" -H 'Content-Type: application/json' \
  --data '{"ppDate":"2026-09-12","engagementHospitalId":"hosp-1","labValues":{"hb":11.0}}' \
  | jq -r '.data.id')"
echo "  (created row for submit: ${ROW_ID})"

check "patient submits the draft -> 200 pending" \
  200 PUT "/followup/rows/${ROW_ID}/submit" "$TOK_PATIENT"

check "re-submitting the same row -> 409 (already submitted)" \
  409 PUT "/followup/rows/${ROW_ID}/submit" "$TOK_PATIENT"

check "list own rows" \
  200 GET "/followup/rows" "$TOK_PATIENT"

check "doctor cannot create a follow-up row -> 403" \
  403 POST "/followup/rows" "$TOK_DOCTOR" "$DRAFT"

summary
