#!/usr/bin/env bash
# Publishes a vsix with a Marketplace Trusted Publishing credential, without any stored
# secret, and waits for Marketplace's verdict. Runs in a job that may request an identity
# token, and needs the workflow's Trusted Publishing policy. See docs/publicering.md.
#
# Only curl and jq, on purpose: this job holds the credential, so no npm package runs in it.
# The only JavaScript in the job is the two pinned GitHub actions that fetch the files.
# The calls are the ones tfx makes. Microsoft documents no Gallery REST API, so docs/publicering.md
# says where they come from. An answer this script does not understand can only end in a red run.
#
# Usage: publishToMarketplace.sh <vsix> <publisher> <extension id> <version>
set -euo pipefail

vsix="$1"
publisher="$2"
extension_id="$3"
version="$4"

# Only the tests set these.
marketplace="${MARKETPLACE_URL:-https://marketplace.visualstudio.com}"
deadline_seconds="${VALIDATION_DEADLINE_SECONDS:-1500}"
poll_seconds="${POLL_SECONDS:-20}"

extension_url="${marketplace}/_apis/gallery/publishers/${publisher}/extensions/${extension_id}"
accept="Accept: application/json;api-version=7.2-preview.2"
answer="$(mktemp)"
trap 'rm -f "${answer}"' EXIT

# Marketplace credentials live for 15 minutes, so a new one is fetched whenever the polling
# has used the current one for 10 minutes. Secrets reach curl through its standard input,
# because a command line can be read by any other process.
fetch_credential() {
  local github_token exchange credential
  github_token="$(curl --silent --show-error --fail-with-body --max-time 60 --config - \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=marketplace.visualstudio.com" \
    <<< "header = \"Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}\"" | jq --exit-status --raw-output .value)"
  echo "::add-mask::${github_token}"

  if ! exchange="$(curl --silent --show-error --fail-with-body --max-time 60 --request POST --config - \
    --header "Accept: application/json" \
    --header "Content-Type: application/json" \
    --data "{\"publisherName\":\"${publisher}\"}" \
    "${marketplace}/_apis/gallery/token?api-version=7.2-preview.1" \
    <<< "header = \"Authorization: FederatedToken ${github_token}\"")"; then
    echo "::error::Marketplace refused the token exchange: ${exchange}"
    exit 1
  fi
  if ! credential="$(jq --exit-status --raw-output .credential <<< "${exchange}")"; then
    echo "::error::Marketplace answered the token exchange without a credential."
    exit 1
  fi
  use_credential "${credential}"
}

use_credential() {
  echo "::add-mask::$1"
  basic_auth="$(printf 'OAuth:%s' "$1" | base64 | tr -d '\n')"
  echo "::add-mask::${basic_auth}"
  credential_fetched_at="${SECONDS}"
}

marketplace_curl() {
  curl --silent --show-error --max-time 300 --output "${answer}" --write-out '%{http_code}' --config - "$@" \
    <<< "header = \"Authorization: Basic ${basic_auth}\"
header = \"X-TFS-FedAuthRedirect: Suppress\""
}

# Prints the HTTP status, and leaves the answer in its file.
read_extension() {
  marketplace_curl --header "${accept}" "$1" || true
}

upload() {
  local status
  status="$(marketplace_curl --request "$1" --upload-file "${vsix}" \
    --header "${accept}" \
    --header "Content-Type: application/octet-stream" \
    --header "Transfer-Encoding: chunked" \
    --header "Expect:" \
    "$2" || true)"
  if [[ "${status}" != 2?? ]]; then
    echo "::error::Marketplace refused the upload (HTTP ${status}): $(jq --raw-output '.message // "no reason given"' "${answer}" 2> /dev/null || true)"
    exit 1
  fi
}

# Read as tfx reads it: a message is a rejection, the validated flag is success, and anything else is still pending.
verdict='
  ((.versions // []) | map(select(.version == $version)) | first) as $found
  | if $found == null then "pending"
    elif ($found.validationResultMessage // "") != "" then "rejected"
    elif ($found.flags | if type == "number" then . % 2 == 1
         elif type == "string" then ascii_downcase | gsub("\\s"; "") | split(",") | index("validated") != null
         else false end) then "success"
    else "pending" end'

fetch_credential

# Only 404 means that the extension does not exist. Anything else says nothing about it, so nothing is uploaded.
status="$(read_extension "${extension_url}?flags=1")"
case "${status}" in
  200) upload PUT "${extension_url}?bypassScopeCheck=false" ;;
  404) upload POST "${marketplace}/_apis/gallery/extensions" ;;
  *)
    echo "::error::Could not read ${publisher}.${extension_id} (HTTP ${status}). Nothing was uploaded."
    exit 1
    ;;
esac

deadline=$((SECONDS + deadline_seconds))
while true; do
  if (( SECONDS - credential_fetched_at > 600 )); then
    fetch_credential
  fi
  # A failed call is not a verdict on the version: keep polling until the deadline.
  status="$(read_extension "${extension_url}?version=${version}&flags=1")"
  result=""
  if [[ "${status}" == 200 ]]; then
    result="$(jq --raw-output --arg version "${version}" "${verdict}" "${answer}" 2> /dev/null || true)"
  fi
  case "${result}" in
    success) break ;;
    rejected)
      echo "::error::Marketplace rejected ${version}: $(jq --raw-output --arg version "${version}" '.versions[] | select(.version == $version) | .validationResultMessage' "${answer}")"
      exit 1
      ;;
    *) echo "Validation of ${version}: ${result:-no answer yet (HTTP ${status})}" ;;
  esac
  if (( SECONDS >= deadline )); then
    echo "::error::${version} was uploaded but Marketplace had not validated it after $((deadline_seconds / 60)) minutes. See docs/publicering.md."
    exit 1
  fi
  sleep "${poll_seconds}"
done

echo "${version} is uploaded and valid."
