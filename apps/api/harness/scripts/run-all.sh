#!/usr/bin/env bash
# Runs the whole API smoke suite against the local harness.
#
#   1. builds the api workspace (tsc -> dist/) unless SKIP_BUILD=1
#   2. starts the harness on a free port (default 4000, override with PORT)
#   3. exports BASE_URL and runs every smoke-*.sh
#   4. aggregates PASS/FAIL and stops the harness
#
# To point the SAME scripts at a real deployment instead, skip this runner and:
#   export BASE_URL=https://<api-id>.execute-api.ap-south-1.amazonaws.com
#   ./smoke-hospital.sh   # ...etc
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${DIR}/../.." && pwd)"           # apps/api
PORT="${PORT:-4000}"
export BASE_URL="${BASE_URL:-http://localhost:${PORT}}"

echo "======================================================================"
echo "API SMOKE SUITE   (harness port ${PORT}, BASE_URL=${BASE_URL})"
echo "======================================================================"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "• building @postopcare/api (tsc) ..."
  ( cd "${API_DIR}" && npm run build >/tmp/harness_build.log 2>&1 ) || {
    echo "BUILD FAILED — see /tmp/harness_build.log"; tail -40 /tmp/harness_build.log; exit 1;
  }
  echo "  build OK"
fi

SERVER_JS="${API_DIR}/dist/harness/server.js"
if [ ! -f "${SERVER_JS}" ]; then
  echo "harness not found at ${SERVER_JS} (did the build emit it?)"; exit 1
fi

echo "• starting harness ..."
PORT="${PORT}" node "${SERVER_JS}" >/tmp/harness_server.log 2>&1 &
HARNESS_PID=$!
cleanup() {
  if kill -0 "${HARNESS_PID}" 2>/dev/null; then
    kill "${HARNESS_PID}" 2>/dev/null
    wait "${HARNESS_PID}" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# Wait for the port to accept connections.
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://localhost:${PORT}/" 2>/dev/null; then break; fi
  if ! kill -0 "${HARNESS_PID}" 2>/dev/null; then
    echo "harness exited early — log:"; cat /tmp/harness_server.log; exit 1
  fi
  sleep 0.1
done
echo "  harness up (pid ${HARNESS_PID})"
echo

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_SUITES=()

for script in smoke-hospital.sh smoke-patient.sh smoke-followup.sh smoke-dose.sh smoke-admin.sh smoke-chat.sh; do
  echo
  echo "######################################################################"
  echo "# ${script}"
  echo "######################################################################"
  if bash "${DIR}/${script}"; then
    :
  else
    FAILED_SUITES+=("${script}")
  fi
  # Pull this suite's PASS/FAIL off its summary line.
done

echo
echo "######################################################################"
echo "# OVERALL"
echo "######################################################################"
if [ "${#FAILED_SUITES[@]}" -eq 0 ]; then
  echo "ALL SUITES PASSED"
  exit 0
else
  echo "SUITES WITH FAILURES: ${FAILED_SUITES[*]}"
  exit 1
fi
