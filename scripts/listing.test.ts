// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import devManifest from "../vss-extension.dev.json";
import sharedManifest from "../vss-extension.json";
import publicManifest from "../vss-extension.public.json";

const REPOSITORY = "https://github.com/andersmoldin/Waypoint";

const inRepo = (path: string) => new URL(`../${path}`, import.meta.url);

/** Width, height and color type from a PNG's IHDR chunk. Throws on anything that is not a PNG. */
function pngHeader(path: string): { width: number; height: number; hasAlpha: boolean } {
  const file = readFileSync(inRepo(path));
  expect(file.subarray(1, 4).toString("latin1")).toBe("PNG");
  const rgbaColorType = 6;
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20), hasAlpha: file[25] === rgbaColorType };
}

describe("the manifests", () => {
  it("make the public extension waypoint and the private one waypoint-dev", () => {
    expect(publicManifest).toMatchObject({ id: "waypoint", name: "Waypoint", public: true });
    expect(devManifest).toMatchObject({ id: "waypoint-dev", name: "Waypoint (dev)", public: false });
  });

  // tfx keeps the first value of a key like id, so a manifest cannot override another one. The result
  // would be a public extension with the dev extension's id. Only files is added together.
  it("never set the same key twice", () => {
    const keys = (manifest: object) => Object.keys(manifest).filter((key) => key !== "files");
    const shared = keys(sharedManifest);

    expect(keys(publicManifest).filter((key) => shared.includes(key))).toEqual([]);
    expect(keys(devManifest).filter((key) => shared.includes(key))).toEqual([]);
  });

  it("leave the version at a placeholder, because the build writes it in", () => {
    expect(sharedManifest.version).toBe("0.0.0");
  });

  it("give the public listing a description that fits the Marketplace card", () => {
    expect(publicManifest.description.length).toBeLessThanOrEqual(200);
  });
});

describe("the listing", () => {
  it("packages only files that exist in the repository", () => {
    const paths = [
      sharedManifest.icons.default,
      ...sharedManifest.contributions.flatMap(({ properties }) => Object.values(properties.icon ?? {})),
      publicManifest.content.details.path,
      publicManifest.content.license.path,
      ...publicManifest.screenshots.map(({ path }) => path),
    ];

    for (const path of paths) {
      expect(existsSync(inRepo(path)), path).toBe(true);
    }
  });

  it("has screenshots at the size Marketplace recommends", () => {
    expect(publicManifest.screenshots.length).toBeGreaterThan(0);
    for (const { path } of publicManifest.screenshots) {
      expect(pngHeader(path)).toMatchObject({ width: 1366, height: 768 });
    }
  });

  it("links to the license, the privacy policy, support and the repository", () => {
    expect(publicManifest.links).toEqual({
      license: { uri: `${REPOSITORY}/blob/main/LICENSE` },
      privacypolicy: { uri: `${REPOSITORY}/blob/main/PRIVACY.md` },
      support: { uri: `${REPOSITORY}/issues` },
    });
    expect(publicManifest.repository.uri).toBe(REPOSITORY);
  });

  const readme = readFileSync(inRepo(publicManifest.content.details.path), "utf8");

  it("is the README, which links to the security documents", () => {
    expect(readme).toContain(`${REPOSITORY}/blob/main/SECURITY.md`);
    expect(readme).toContain(`${REPOSITORY}/blob/main/SECURITY_AUDIT.md`);
  });

  it("has images in the README that are packaged with it", () => {
    const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(([, path]) => path);

    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image, "Only files in the package reach Marketplace").toMatch(/^images\//);
      expect(existsSync(inRepo(image)), image).toBe(true);
    }
  });

  it("links only to documents that exist, apart from the two that must exist before a release", () => {
    const documents = [...readme.matchAll(/\/blob\/main\/([^)#\s]+)/g)].map(([, path]) => path);
    // scripts/releaseGate.sh refuses to release until these exist.
    const requiredBeforeARelease = ["SECURITY_AUDIT.md", "ACCESSIBILITY.md"];

    for (const document of documents.filter((path) => !requiredBeforeARelease.includes(path))) {
      expect(existsSync(inRepo(document)), document).toBe(true);
    }
  });
});

describe("the icons", () => {
  it.each([
    ["light", 128],
    ["light", 256],
    ["dark", 128],
    ["dark", 256],
  ])("are checked in as a %s PNG of %i px with an alpha channel", (variant, size) => {
    expect(pngHeader(`images/icons/waypoint-${variant}-${size}.png`)).toEqual({ width: size, height: size, hasAlpha: true });
  });
});

describe("the hub's menu icon", () => {
  const hub = sharedManifest.contributions.find(({ id }) => id === "waypoint-hub");
  const icon = hub?.properties.icon;

  // The menu shows it as a 16 px image, so 32 px is crisp on Retina. Transparent, so the menu's
  // background and the selected row's tint show through, as they do behind the neighbors' glyphs.
  it("is a 32 px PNG with an alpha channel in a light and a dark variant", () => {
    expect(icon).toEqual({ light: "images/icons/waypoint-hub-light-32.png", dark: "images/icons/waypoint-hub-dark-32.png" });
    for (const path of Object.values(icon ?? {})) {
      expect(pngHeader(path), path).toEqual({ width: 32, height: 32, hasAlpha: true });
    }
  });

  it("differs between the variants, because the theme's color is baked into the file", () => {
    const files = Object.values(icon ?? {}).map((path) => readFileSync(inRepo(path)));
    expect(files).toHaveLength(2);
    expect(files[0].equals(files[1])).toBe(false);
  });

  it("is not the Marketplace icon, which stays as it is", () => {
    expect(icon).toBeDefined();
    expect(sharedManifest.icons.default).toBe("images/icons/waypoint-light-128.png");
    expect(Object.values(icon ?? {})).not.toContain(sharedManifest.icons.default);
  });
});
