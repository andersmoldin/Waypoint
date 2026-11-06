#!/usr/bin/env bash
# Publishes a vsix with a Marketplace Trusted Publishing credential, without any stored
# secret, and waits for Marketplace's verdict. Runs in a job that may request an identity
# token, and needs the workflow's Trusted Publishing policy. See docs/publicering.md.
# Usage: publishToMarketplace.sh <vsix> <publisher> <version>
set -euo pipefail

vsix="$1"
publisher="$2"
version="$3"

# Marketplace credentials live for 15 minutes, so a new one is fetched for each
# phase and whenever the polling has used the current one for 10 minutes.
fetch_credential() {
  local github_token exchange
  github_token="$(curl --silent --show-error --fail-with-body \
    --header "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=marketplace.visualstudio.com" | jq --exit-status --raw-output .value)"
  echo "::add-mask::${github_token}"

  if ! exchange="$(curl --silent --show-error --fail-with-body --request POST \
    --header "Authorization: FederatedToken ${github_token}" \
    --header "Accept: application/json" \
    --header "Content-Type: application/json" \
    --data "{\"publisherName\":\"${publisher}\"}" \
    "https://marketplace.visualstudio.com/_apis/gallery/token?api-version=7.2-preview.1")"; then
    echo "::error::Marketplace refused the token exchange: ${exchange}"
    exit 1
  fi
  credential="$(jq --exit-status --raw-output .credential <<< "${exchange}")"
  echo "::add-mask::${credential}"
  credential_fetched_at="${SECONDS}"
}

tfx() {
  # --no: never the unrelated package called tfx from the registry, should the installed one be missing.
  npx --no tfx extension "$1" --vsix "${vsix}" --auth-type pat --token "${credential}" --no-prompt "${@:2}"
}

fetch_credential
# tfx's own wait for validation gives up after about four minutes, so it is skipped
# here and replaced by the polling below. Sharing is not done here: a Trusted Publishing
# credential may only upload, update and read validation status (403 on share).
tfx publish --no-wait-validation

deadline=$((SECONDS + 1500))
while true; do
  if (( SECONDS - credential_fetched_at > 600 )); then
    fetch_credential
  fi
  # A failed call is not a verdict on the version: keep polling until the deadline.
  result="$(tfx isvalid --version "${version}" --json || true)"
  status="$(jq --raw-output '.status // empty' <<< "${result}" 2>/dev/null || true)"
  case "${status}" in
    success) break ;;
    pending | "") echo "Validation of ${version}: ${status:-no answer yet}" ;;
    *)
      echo "::error::Marketplace rejected ${version}: $(jq --raw-output '.message // "no reason given"' <<< "${result}")"
      exit 1
      ;;
  esac
  if (( SECONDS >= deadline )); then
    echo "::error::${version} was uploaded but Marketplace had not validated it after 25 minutes. See docs/publicering.md."
    exit 1
  fi
  sleep 20
done

echo "${version} is uploaded and valid."
