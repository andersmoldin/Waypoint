// @vitest-environment node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CREDENTIAL = "the-marketplace-credential";
const BASIC = `Basic ${Buffer.from(`OAuth:${CREDENTIAL}`).toString("base64")}`;
const VERSION = "2026.11.7";
const EXTENSION = "/_apis/gallery/publishers/andersmoldin-dev/extensions/waypoint-dev";

interface Seen {
  method: string;
  path: string;
  authorization?: string;
  sha256: string;
}

type Answer = { status: number; body?: unknown };

/** What the made-up Marketplace answers. A verdict is taken for each question about the version, and the last one stays. */
interface Marketplace {
  exchange?: Answer;
  read?: Answer;
  upload?: Answer;
  verdicts?: Answer[];
}

const validated = (flags: unknown = "validated"): Answer => ({ status: 200, body: { versions: [{ version: VERSION, flags }] } });

let server: Server;
let directory: string;
let seen: Seen[];
let marketplace: Marketplace;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "waypoint-publish-"));
  writeFileSync(join(directory, "package.vsix"), "the bytes of the package");
  seen = [];
  marketplace = {};
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => answer(request, response, Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
});

function answer(request: IncomingMessage, response: ServerResponse, body: Buffer): void {
  const { pathname, searchParams } = new URL(request.url ?? "", "http://stub");
  seen.push({ method: request.method ?? "", path: pathname, authorization: request.headers.authorization, sha256: createHash("sha256").update(body).digest("hex") });
  const send = ({ status, body: sent = {} }: Answer) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(sent));
  };
  if (pathname === "/oidc") return send({ status: 200, body: { value: "the-oidc-token" } });
  if (pathname === "/_apis/gallery/token") return send(marketplace.exchange ?? { status: 200, body: { credential: CREDENTIAL } });
  if (request.method === "PUT" || (request.method === "POST" && pathname === "/_apis/gallery/extensions")) return send(marketplace.upload ?? { status: 200 });
  if (searchParams.has("version")) return send((marketplace.verdicts ?? []).length > 1 ? (marketplace.verdicts as Answer[]).shift() as Answer : (marketplace.verdicts ?? [validated()])[0]);
  return send(marketplace.read ?? { status: 200, body: {} });
}

/** Runs the real script against the made-up Marketplace, with a curl that notes its arguments on the way to the real one. */
function publish(deadlineSeconds = 60): Promise<{ status: number | null; output: string; arguments: string }> {
  const log = join(directory, "curl-arguments");
  const shim = join(directory, "curl");
  writeFileSync(shim, `#!/usr/bin/env bash\necho "$*" >> "${log}"\nexec "$(PATH="\${ORIGINAL_PATH}" command -v curl)" "$@"\n`);
  chmodSync(shim, 0o755);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return new Promise((resolve) => {
    const child = spawn("scripts/publishToMarketplace.sh", [join(directory, "package.vsix"), "andersmoldin-dev", "waypoint-dev", VERSION], {
      env: {
        ...process.env,
        ORIGINAL_PATH: process.env.PATH,
        PATH: `${directory}:${process.env.PATH}`,
        ACTIONS_ID_TOKEN_REQUEST_URL: `${url}/oidc?kind=github`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "the-request-token",
        MARKETPLACE_URL: url,
        POLL_SECONDS: "0",
        VALIDATION_DEADLINE_SECONDS: String(deadlineSeconds),
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status, output, arguments: readFileSync(log, "utf8") }));
  });
}

const uploads = () => seen.filter(({ method, path }) => method === "PUT" || (method === "POST" && path === "/_apis/gallery/extensions"));

const PACKAGE_SHA256 = createHash("sha256").update("the bytes of the package").digest("hex");

describe("publishing a package", () => {
  it("updates an extension that exists, with the package's bytes, and waits for the verdict", async () => {
    const { status, output } = await publish();

    expect(output).toContain(`${VERSION} is uploaded and valid.`);
    expect(status).toBe(0);
    expect(uploads()).toEqual([{ method: "PUT", path: EXTENSION, authorization: BASIC, sha256: PACKAGE_SHA256 }]);
  });

  it("creates an extension that does not exist yet", async () => {
    marketplace.read = { status: 404 };

    const { status } = await publish();

    expect(status).toBe(0);
    expect(uploads()).toEqual([{ method: "POST", path: "/_apis/gallery/extensions", authorization: BASIC, sha256: PACKAGE_SHA256 }]);
  });

  it.each([
    ["as a number", 1],
    ["among other flags", "public, validated"],
  ])("takes the validated flag %s", async (_kind, flags) => {
    marketplace.verdicts = [validated(flags)];

    expect((await publish()).status).toBe(0);
  });

  it("keeps asking while the version is pending, and through a failed call", async () => {
    marketplace.verdicts = [{ status: 500 }, { status: 200, body: {} }, validated("none"), validated()];

    const { status } = await publish();

    expect(status).toBe(0);
    expect(seen.filter(({ method, path }) => method === "GET" && path === EXTENSION).length).toBeGreaterThan(4);
  });

  it("never puts a credential or a token on a command line, where another process could read it", async () => {
    const { arguments: commandLines } = await publish();

    for (const secret of [CREDENTIAL, BASIC, "the-oidc-token", "the-request-token"]) expect(commandLines).not.toContain(secret);
  });

  it("asks GitHub's token to be masked before it is used, and the credential in both its forms", async () => {
    const { output } = await publish();

    for (const secret of ["the-oidc-token", CREDENTIAL, BASIC.replace("Basic ", "")]) expect(output).toContain(`::add-mask::${secret}`);
  });
});

describe("a failed publish", () => {
  const failsWith = async (message: string, deadlineSeconds?: number) => {
    const { status, output } = await publish(deadlineSeconds);

    expect(output).toContain(message);
    expect(status).toBe(1);
  };

  it("says what Marketplace rejected the version for", async () => {
    marketplace.verdicts = [{ status: 200, body: { versions: [{ version: VERSION, flags: "none", validationResultMessage: "Too large." }] } }];

    await failsWith(`Marketplace rejected ${VERSION}: Too large.`);
  });

  it("does not turn green on an answer nobody understands", async () => {
    marketplace.verdicts = [{ status: 200, body: { versions: [{ version: VERSION, flags: { surprise: true } }] } }];

    await failsWith("had not validated it", 1);
  });

  it("gives up after the deadline when the version never shows up", async () => {
    marketplace.verdicts = [{ status: 200, body: { versions: [{ version: "2026.11.6", flags: "validated" }] } }];

    await failsWith("had not validated it", 1);
  });

  it("says that the upload was refused, and why", async () => {
    marketplace.upload = { status: 400, body: { message: "Version number must increase." } };

    await failsWith("Marketplace refused the upload (HTTP 400): Version number must increase.");
  });

  it.each([401, 403, 500])("uploads nothing when the extension cannot be read, with HTTP %i", async (http) => {
    marketplace.read = { status: http };

    await failsWith("Nothing was uploaded");
    expect(uploads()).toEqual([]);
  });

  it("uploads nothing when Marketplace refuses the token exchange", async () => {
    marketplace.exchange = { status: 403, body: { message: "No policy." } };

    await failsWith("Marketplace refused the token exchange");
    expect(uploads()).toEqual([]);
  });
});
