#!/usr/bin/env bash
# Chat read flows (WP 5.1 — spec §7.8). A care-team thread `thread-1` is seeded
# for patient-1 with doctor-1 as the primary doctor (see harness/seed.ts).
# Only the HTTP GET reads are exposed here; send/markRead/typing are WebSocket
# actions not reachable over plain HTTP.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${DIR}/_lib.sh"

echo "### CHAT DOMAIN (HTTP reads) ###"

check "patient lists own care-team threads -> 200" \
  200 GET "/chat/threads/patient-1" "$TOK_PATIENT"

check "primary doctor lists the patient's threads -> 200" \
  200 GET "/chat/threads/patient-1" "$TOK_DOCTOR"

check "patient reads messages in the thread -> 200" \
  200 GET "/chat/threads/thread-1/messages" "$TOK_PATIENT"

check "doctor reads messages in the thread -> 200" \
  200 GET "/chat/threads/thread-1/messages" "$TOK_DOCTOR"

check "another patient cannot read this thread's messages -> 403" \
  403 GET "/chat/threads/thread-1/messages" "$TOK_OTHER_PATIENT"

check "unauthenticated read rejected -> 401" \
  401 GET "/chat/threads/thread-1/messages" ""

check "unknown chat route -> 404" \
  404 GET "/chat/threads/thread-1/unknown" "$TOK_PATIENT"

summary
