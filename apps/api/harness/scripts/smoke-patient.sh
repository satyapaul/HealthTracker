#!/usr/bin/env bash
# Patient chart CRUD + doctor dashboard (WP 2.1 / 3.4).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${DIR}/_lib.sh"

echo "### PATIENT DOMAIN ###"

# Admin onboards a new chart (all §7.1 required fields; defaults follow-up hospital).
NEW_CHART='{"name":"New Patient","maxId":"MAX-NEW-1","ageYears":5,"sex":"F","dateOfOperation":"2026-06-01","diagnosis":"DCLD","histopathology":"PBC","anastomosisType":"Roux-en-Y","contactEmail":"c@example.com","procedureHospitalId":"hosp-1"}'
check "admin creates a patient chart -> 201" \
  201 POST "/patients" "$TOK_ADMIN" "$NEW_CHART"

check "non-admin (patient) cannot create a chart -> 403" \
  403 POST "/patients" "$TOK_PATIENT" "$NEW_CHART"

check "create missing required field (diagnosis) -> 400" \
  400 POST "/patients" "$TOK_ADMIN" \
  '{"name":"X","maxId":"MAX-X","ageYears":5,"sex":"F","dateOfOperation":"2026-06-01","histopathology":"PBC","anastomosisType":"Y","contactEmail":"c@example.com","procedureHospitalId":"hosp-1"}'

check "patient reads own seeded chart" \
  200 GET "/patients/patient-1" "$TOK_PATIENT"

check "cross-patient read denied -> 404 (no leak)" \
  404 GET "/patients/patient-1" "$TOK_OTHER_PATIENT"

check "doctor dashboard: assigned patients + pending badge" \
  200 GET "/patients" "$TOK_DOCTOR"

check "doctor dashboard filtered by hospital (D-13)" \
  200 GET "/patients?hospital_id=hosp-1" "$TOK_DOCTOR"

summary
