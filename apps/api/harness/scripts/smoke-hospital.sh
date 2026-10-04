#!/usr/bin/env bash
# Hospital picker + read endpoints (WP 3.1/3.3).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${DIR}/_lib.sh"

echo "### HOSPITAL DOMAIN ###"

check "doctor picker (scope=affiliated): Virtual pinned + affiliated hospital" \
  200 GET "/hospitals?scope=affiliated" "$TOK_DOCTOR"

check "patient picker (forPatient=own): primary doctor's hospitals" \
  200 GET "/hospitals?forPatient=patient-1" "$TOK_PATIENT"

check "picker rejects neither scope nor forPatient (400)" \
  400 GET "/hospitals" "$TOK_DOCTOR"

check "patient forPatient another patient -> 403" \
  403 GET "/hospitals?forPatient=patient-1" "$TOK_OTHER_PATIENT"

check "hospital detail by id" \
  200 GET "/hospitals/hosp-1" "$TOK_PATIENT"

check "hospital detail unknown -> 404" \
  404 GET "/hospitals/nope" "$TOK_PATIENT"

check "doctor own affiliations (H-05)" \
  200 GET "/doctors/me/affiliations" "$TOK_DOCTOR"

check "patient cannot read affiliations -> 403" \
  403 GET "/doctors/me/affiliations" "$TOK_PATIENT"

check "unauthenticated picker -> 401" \
  401 GET "/hospitals?scope=affiliated" ""

summary
