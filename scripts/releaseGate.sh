#!/usr/bin/env bash
# Refuses a release before anything is built or anyone is asked to approve it.
# Needs GITHUB_REPOSITORY, GITHUB_SHA and a GH_TOKEN that can read the repository.
set -euo pipefail

failed=0
refuse() {
  echo "::error::$1"
  failed=1
}

# The tag must be on main: main is identical to the tagged commit or ahead of it.
position="$(gh api "repos/${GITHUB_REPOSITORY}/compare/${GITHUB_SHA}...main" --jq .status)"
if [[ "${position}" != "identical" && "${position}" != "ahead" ]]; then
  refuse "The tagged commit ${GITHUB_SHA} is not on main (main is ${position})."
fi

# Without a required reviewer, a tag alone would publish. Anything but a positive count refuses.
if ! reviewers="$(gh api "repos/${GITHUB_REPOSITORY}/environments/marketplace" \
  --jq '[.protection_rules[]? | select(.type == "required_reviewers")] | length' 2>&1)"; then
  refuse "Could not read the environment marketplace, which must exist with a required reviewer: ${reviewers}"
elif ! [[ "${reviewers}" =~ ^[1-9][0-9]*$ ]]; then
  refuse "The environment marketplace has no required reviewer. See docs/publicering.md."
fi

# The newest e2e-testorg status decides (statuses come newest first), and only the owner's counts.
e2e="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/statuses?per_page=100" \
  --jq '[.[] | select(.context == "e2e-testorg")][0] | "\(.state) \(.creator.login)"')"
if [[ "${e2e}" != "success andersmoldin" ]]; then
  refuse "Commit ${GITHUB_SHA} has no successful e2e-testorg status from the owner (found: ${e2e}). Run npm run e2e from that commit, then Re-run failed jobs. See docs/publicering.md."
fi

# The listing links to these, and they come from the audits before the first release.
for document in SECURITY_AUDIT.md ACCESSIBILITY.md; do
  if [[ ! -f "${document}" ]]; then
    refuse "${document} is missing, and the listing links to it."
  fi
done

exit "${failed}"
