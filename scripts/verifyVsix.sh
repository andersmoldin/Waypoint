#!/usr/bin/env bash
# Checks what a built vsix really says before it can be published: its identity, its version,
# whether it is public, and that it holds what this repository builds and nothing else. The
# manifests alone do not prove this, because tfx merges them by its own rules. Run from the root
# of the repository, since it compares with the page's source.
# Usage: verifyVsix.sh <vsix> <publisher> <id> <version> public|private
set -euo pipefail

vsix="$1"
publisher="$2"
id="$3"
version="$4"
visibility="$5"

refuse() {
  echo "::error::${vsix} $1"
  exit 1
}

manifest="$(unzip -p "${vsix}" extension.vsixmanifest)"

identity="$(grep --only-matching '<Identity [^>]*>' <<< "${manifest}")"
for attribute in "Publisher=\"${publisher}\"" "Id=\"${id}\"" "Version=\"${version}\""; do
  if ! grep --quiet --fixed-strings " ${attribute}" <<< "${identity}"; then
    refuse "should have ${attribute}: ${identity}"
  fi
done

if grep --quiet '<GalleryFlags>[^<]*Public' <<< "${manifest}"; then
  actual=public
else
  actual=private
fi
if [[ "${actual}" != "${visibility}" ]]; then
  refuse "is ${actual}, it should be ${visibility}."
fi

contributions="$(unzip -p "${vsix}" extension.vsomanifest)"
scopes="$(jq --compact-output .scopes <<< "${contributions}")"
if [[ "${scopes}" != '["vso.work"]' ]]; then
  refuse "asks for the scopes ${scopes}, it should ask only for vso.work."
fi
if ! jq --exit-status '[.contributions[].properties.uri // empty] | length > 0 and all(test("^dist/[a-z]+\\.html$"))' <<< "${contributions}" > /dev/null; then
  refuse "has a contribution whose page is not one of its own."
fi

# A package with another file than these is not what this repository builds, also if the file is a source map or a second manifest.
unexpected="$(unzip -Z1 "${vsix}" | grep --invert-match --extended-regexp '^(\[Content_Types\]\.xml|extension\.vs(ix|o)manifest|LICENSE|README\.md|dist/|dist/(hub|settings)\.(html|js|js\.LICENSE\.txt)|images/|images/(icons|screenshots)/|images/(icons|screenshots)/[a-z0-9-]+\.png)$' || true)"
if [[ -n "${unexpected}" ]]; then
  refuse "holds what it should not: ${unexpected}"
fi

policy="$(grep --only-matching "default-src[^\"]*" src/hub/hub.html)"
for page in dist/hub.html dist/settings.html; do
  if ! unzip -p "${vsix}" "${page}" | grep --quiet --fixed-strings "${policy}"; then
    refuse "has a ${page} without the Content Security Policy in src/hub/hub.html."
  fi
done

echo "${vsix} is ${publisher}.${id} ${version}, ${visibility}, and holds what it should."
