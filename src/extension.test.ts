import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import devManifest from "../vss-extension.dev.json";
import manifest from "../vss-extension.json";
import publicManifest from "../vss-extension.public.json";
import hubHtml from "./hub/hub.html?raw";

describe("the extension an organization installs", () => {
  it("asks for no scope other than vso.work", () => {
    expect(manifest.scopes).toEqual(["vso.work"]);
  });

  it("comes from the publisher andersmoldin", () => {
    expect(publicManifest.publisher).toBe("andersmoldin");
  });

  // A publishing credential is asked for by publisher, and the dev extension is published unattended on every merge.
  it("has a publisher of its own, apart from the private dev extension's", () => {
    expect(devManifest.publisher).toBe("andersmoldin-dev");
    expect(devManifest.publisher).not.toBe(publicManifest.publisher);
  });

  it("installs in Azure DevOps Services, which is all it is built for", () => {
    expect(manifest.targets).toEqual([{ id: "Microsoft.VisualStudio.Services.Cloud" }]);
  });

  it("adds exactly one hub, called Waypoint, to the Boards group", () => {
    expect(manifest.contributions.filter(({ type }) => type === "ms.vss-web.hub")).toEqual([
      expect.objectContaining({
        targets: ["ms.vss-work-web.work-hub-group"],
        properties: expect.objectContaining({ name: "Waypoint" }),
      }),
    ]);
  });

  it("adds a settings panel the hub can open, and nothing else", () => {
    expect(manifest.contributions.filter(({ type }) => type !== "ms.vss-web.hub")).toEqual([
      // The type Microsoft's panel example has. The host opened one of type ms.vss-web.control with its title and nothing in it, see #55.
      { id: "waypoint-settings-panel", type: "ms.vss-web.external-content", properties: { uri: "dist/settings.html" } },
    ]);
  });
});

describe("the pages of the hub and its settings panel", () => {
  /** Every source in the page's Content Security Policy, by directive. */
  function contentSecurityPolicy(): Record<string, string[]> {
    const page = new DOMParser().parseFromString(hubHtml, "text/html");
    const content = page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";
    return Object.fromEntries(
      content
        .split(";")
        .map((directive) => directive.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...sources]) => [name, sources]),
    );
  }

  it("blocks whatever the policy does not explicitly allow", () => {
    expect(contentSecurityPolicy()).toMatchObject({
      "default-src": ["'none'"],
      // These two do not fall back to default-src.
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
    });
  });

  it("can reach Azure DevOps", () => {
    expect(contentSecurityPolicy()["connect-src"]).toContain("https://dev.azure.com");
  });

  it("lists no other host than Azure DevOps to fetch from", () => {
    const keywordsAndInlineData = ["'none'", "'self'", "'unsafe-inline'", "data:"];
    const azureDevOpsHost = /^https:\/\/(\*\.)?dev\.azure\.com$|^https:\/\/\*\.visualstudio\.com$/;

    const otherSources = Object.values(contentSecurityPolicy())
      .flat()
      .filter((source) => !keywordsAndInlineData.includes(source) && !azureDevOpsHost.test(source));

    expect(otherSources).toEqual([]);
  });
});

describe("the dependency versions", () => {
  it("are locked exactly, with no version ranges", () => {
    const { dependencies, devDependencies } = packageJson;
    const ranged = Object.entries({ ...dependencies, ...devDependencies }).filter(
      ([, version]) => !/^\d+\.\d+\.\d+$/.test(version),
    );

    expect(ranged).toEqual([]);
  });
});
