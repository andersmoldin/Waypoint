#!/usr/bin/env bash
# Checks what a built vsix really says before it can be published: its identity, its
# version and whether it is public. The manifests alone do not prove this, because tfx
# merges them by its own rules. Usage: verifyVsix.sh <vsix> <id> <version> public|private
set -euo pipefail

vsix="$1"
id="$2"
version="$3"
visibility="$4"

manifest="$(unzip -p "${vsix}" extension.vsixmanifest)"

identity="$(grep --only-matching '<Identity [^>]*>' <<< "${manifest}")"
for attribute in "Publisher=\"andersmoldin\"" "Id=\"${id}\"" "Version=\"${version}\""; do
  if ! grep --quiet --fixed-strings " ${attribute}" <<< "${identity}"; then
    echo "::error::${vsix} should have ${attribute}: ${identity}"
    exit 1
  fi
done

if grep --quiet '<GalleryFlags>[^<]*Public' <<< "${manifest}"; then
  actual=public
else
  actual=private
fi
if [[ "${actual}" != "${visibility}" ]]; then
  echo "::error::${vsix} is ${actual}, it should be ${visibility}."
  exit 1
fi

echo "${vsix} is ${id} ${version}, ${visibility}."
