// @vitest-environment node
import { describe, expect, it } from "vitest";
import { versionFromTag } from "./versionFromTag";

describe("the version of a release", () => {
  it.each([
    ["v2026.11.0", "2026.11.0"],
    ["v2026.11.1", "2026.11.1"],
    ["v2026.1.12", "2026.1.12"],
    ["v2027.12.0", "2027.12.0"],
  ])("comes from the tag %s as %s", (tag, version) => {
    expect(versionFromTag(tag)).toBe(version);
  });

  it.each([
    ["no v", "2026.11.0"],
    ["a month that does not exist", "v2026.13.0"],
    ["month zero", "v2026.0.1"],
    ["a leading zero in the month", "v2026.01.0"],
    ["a leading zero in the count", "v2026.11.01"],
    ["a year of the wrong length", "v26.11.0"],
    ["a suffix, which Marketplace refuses", "v2026.11.0-build.1"],
    ["a missing part", "v2026.11"],
    ["a line break after the tag", "v2026.11.0\n"],
    ["nothing", ""],
  ])("refuses a tag with %s", (_reason, tag) => {
    expect(() => versionFromTag(tag)).toThrow(/CalVer/);
  });
});
