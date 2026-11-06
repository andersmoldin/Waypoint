/**
 * The tag is the only source of a release's version. CalVer YYYY.M.N: N counts the releases
 * within the month from 0, and no part has a leading zero, because Marketplace wants plain integers.
 */
export function versionFromTag(tag: string): string {
  const match = /^v([1-9]\d{3}\.(?:[1-9]|1[0-2])\.(?:0|[1-9]\d*))$/.exec(tag);
  if (!match) {
    throw new Error(`The tag "${tag}" is not CalVer vYYYY.M.N, for example v2026.11.0.`);
  }
  return match[1];
}

if (import.meta.main) {
  console.log(versionFromTag(process.argv[2] ?? ""));
}
