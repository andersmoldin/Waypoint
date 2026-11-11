// @vitest-environment node
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const POLICY = /<meta[^>]*Content-Security-Policy[\s\S]*?\/>/.exec(readFileSync("src/hub/hub.html", "utf8"))?.[0] ?? "";

const IDENTITY = 'Publisher="andersmoldin" Version="2026.11.0" Id="waypoint-board"';
const GOOD: Record<string, string> = {
  "extension.vsixmanifest": `<Identity Language="en-US" ${IDENTITY}/><GalleryFlags>Public</GalleryFlags>`,
  "extension.vsomanifest": JSON.stringify({ scopes: ["vso.work"], contributions: [{ properties: { uri: "dist/hub.html" } }, { properties: { uri: "dist/settings.html" } }] }),
  "dist/hub.html": POLICY,
  "dist/settings.html": POLICY,
  "dist/hub.js": "",
  "dist/settings.js": "",
  "images/icons/waypoint-light-128.png": "",
  "README.md": "",
  LICENSE: "",
};

const made: string[] = [];
afterEach(() => made.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function verify(files: Record<string, string | null>, expected: string[] = ["andersmoldin", "waypoint-board", "2026.11.0", "public"]) {
  const directory = mkdtempSync(join(tmpdir(), "waypoint-vsix-"));
  made.push(directory);
  for (const [path, content] of Object.entries({ ...GOOD, ...files })) {
    if (content === null) continue;
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  execFileSync("zip", ["--quiet", "--recurse-paths", "package.vsix", "."], { cwd: directory });
  return spawnSync("scripts/verifyVsix.sh", [join(directory, "package.vsix"), ...expected], { encoding: "utf8" });
}

describe("the check of a built vsix", () => {
  it("lets through what this repository builds", () => {
    const { status, stdout } = verify({});

    expect(stdout).toContain("andersmoldin.waypoint-board 2026.11.0, public");
    expect(status).toBe(0);
  });

  it.each<[string, Record<string, string | null>]>([
    ["more scopes than vso.work", { "extension.vsomanifest": JSON.stringify({ scopes: ["vso.work", "vso.code_full"], contributions: [{ properties: { uri: "dist/hub.html" } }] }) }],
    ["a page on another host", { "extension.vsomanifest": JSON.stringify({ scopes: ["vso.work"], contributions: [{ properties: { uri: "https://example.test/hub.html" } }] }) }],
    ["a page without the policy", { "dist/hub.html": "<html></html>" }],
    ["a settings page without the policy", { "dist/settings.html": "<html></html>" }],
    ["a source map", { "dist/hub.js.map": "{}" }],
    ["a script of another name", { "dist/other.js": "" }],
    ["a second manifest", { "dist/extension.vsixmanifest": "" }],
  ])("refuses %s", (_kind, files) => {
    const { status, stdout } = verify(files);

    expect(stdout).toContain("::error::");
    expect(status).toBe(1);
  });

  it.each<[string, string[]]>([
    ["another publisher", ["andersmoldin-dev", "waypoint-board", "2026.11.0", "public"]],
    ["another id", ["andersmoldin", "waypoint-dev", "2026.11.0", "public"]],
    ["another version", ["andersmoldin", "waypoint-board", "2026.11.1", "public"]],
    ["other visibility", ["andersmoldin", "waypoint-board", "2026.11.0", "private"]],
  ])("refuses a package when %s was expected", (_kind, expected) => {
    expect(verify({}, expected).status).toBe(1);
  });
});
