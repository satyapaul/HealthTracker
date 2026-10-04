#!/usr/bin/env bash
# Shared helpers for the API smoke-test scripts.
#
# Every script hits ${BASE_URL} (default http://localhost:4000) so the SAME
# scripts run against the local harness today and a real deployment later —
# just export BASE_URL=https://<api-id>.execute-api.ap-south-1.amazonaws.com.
#
# Dev auth: the harness accepts `Authorization: Bearer dev:<userId>:<role>:<patientId>`.
# Against a real deployment, replace tok_* with a real session token.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"

# Fixture principals (match apps/api/harness/seed.ts IDS).
TOK_ADMIN="dev:admin-1:admin:"
TOK_DOCTOR="dev:doctor-1:doctor:"
TOK_PATIENT="dev:user-patient-1:patient:patient-1"
TOK_OTHER_PATIENT="dev:user-pX:patient:patient-X"

PASS=0
FAIL=0

# check <name> <expected-status> <method> <path> [token] [json-body]
# Prints the request, the response body, and a PASS/FAIL line.
check() {
  local name="$1" expected="$2" method="$3" path="$4" token="${5:-}" body="${6:-}"
  local args=(-s -o /tmp/smoke_body -w '%{http_code}' -X "$method" "${BASE_URL}${path}")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer ${token}")
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
  fi

  local status
  status="$(curl "${args[@]}")"
  local resp
  resp="$(cat /tmp/smoke_body)"

  echo "----------------------------------------------------------------------"
  echo "• ${name}"
  echo "  ${method} ${path}   (expect ${expected})"
  [ -n "$body" ] && echo "  body: ${body}"
  echo "  -> HTTP ${status}"
  # Pretty-print the envelope if it is JSON.
  if echo "$resp" | jq . >/dev/null 2>&1; then
    echo "$resp" | jq -c .
  else
    echo "  ${resp}"
  fi

  if [ "$status" = "$expected" ]; then
    echo "  RESULT: PASS"
    PASS=$((PASS + 1))
  else
    echo "  RESULT: FAIL (got ${status}, expected ${expected})"
    FAIL=$((FAIL + 1))
  fi
}

summary() {
  echo "======================================================================"
  echo "SUMMARY: ${PASS} passed, ${FAIL} failed   (BASE_URL=${BASE_URL})"
  echo "======================================================================"
  [ "$FAIL" -eq 0 ]
}
