#!/usr/bin/env bash
# Admin hospital-registry flow (WP 3.2 — spec §7.0.3). The admin FakeDb seeds
# the Virtual Hospital + lets admin-1 act; doctor-1 is a known doctor user so an
# affiliation can be created against a freshly made hospital.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${DIR}/_lib.sh"

echo "### ADMIN / HOSPITAL-REGISTRY DOMAIN ###"

NEW_HOSPITAL='{"hospitalCode":"APO-DEL","hospitalName":"Apollo Delhi","hospitalType":"general","addressLine1":"Sarita Vihar","city":"New Delhi","country":"India"}'

check "admin creates a hospital -> 201" \
  201 POST "/admin/hospitals" "$TOK_ADMIN" "$NEW_HOSPITAL"

check "duplicate hospital code -> 409" \
  409 POST "/admin/hospitals" "$TOK_ADMIN" "$NEW_HOSPITAL"

check "reserved VIRTUAL code rejected -> 400" \
  400 POST "/admin/hospitals" "$TOK_ADMIN" \
  '{"hospitalCode":"VIRTUAL","hospitalName":"X","hospitalType":"general","addressLine1":"a","city":"b","country":"c"}'

check "cannot create a virtual-type hospital -> 400" \
  400 POST "/admin/hospitals" "$TOK_ADMIN" \
  '{"hospitalCode":"VX1","hospitalName":"X","hospitalType":"virtual","addressLine1":"a","city":"b","country":"c"}'

check "missing address rejected -> 400" \
  400 POST "/admin/hospitals" "$TOK_ADMIN" \
  '{"hospitalCode":"NOADDR","hospitalName":"X","hospitalType":"general"}'

check "non-admin (doctor) cannot create a hospital -> 403" \
  403 POST "/admin/hospitals" "$TOK_DOCTOR" "$NEW_HOSPITAL"

check "admin searches the registry -> 200" \
  200 GET "/admin/hospitals?search=apollo" "$TOK_ADMIN"

# Create a hospital we can affiliate a doctor to, capturing its id.
HOSP_ID="$(curl -s -X POST "${BASE_URL}/admin/hospitals" \
  -H "Authorization: Bearer ${TOK_ADMIN}" -H 'Content-Type: application/json' \
  --data '{"hospitalCode":"FORTIS-1","hospitalName":"Fortis","hospitalType":"specialty","addressLine1":"Road 1","city":"Gurugram","country":"India"}' \
  | jq -r '.data.id')"
echo "  (created hospital for affiliation: ${HOSP_ID})"

check "admin affiliates doctor-1 to the hospital -> 201" \
  201 POST "/admin/hospitals/${HOSP_ID}/affiliations" "$TOK_ADMIN" \
  '{"doctorId":"doctor-1","roleAtHospital":"Transplant Surgeon","isPrimary":true}'

summary
