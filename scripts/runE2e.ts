// Runs the end-to-end test against the test organization and, when it is green, records that
// on the commit as the status e2e-testorg, which the release workflow requires.
// Run with `npm run e2e`, from the commit to release. See docs/publicering.md.
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (git("status", "--porcelain")) {
  console.error("The working tree has changes, so a green run would not say anything about the commit. Commit or remove them first.");
  process.exit(1);
}

const commit = git("rev-parse", "HEAD");

const run = spawnSync("npx", ["playwright", "test"], {
  stdio: "inherit",
  env: { ...process.env, WAYPOINT_E2E_COMMIT: commit },
});
if (run.status !== 0) {
  console.error(`The end-to-end test failed, so ${commit} gets no status and cannot be released.`);
  process.exit(run.status ?? 1);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question("Is the account logged in above a Stakeholder or Reader in the test organization? [y/N] ");
prompt.close();
if (answer.trim().toLowerCase() !== "y") {
  console.error(`The test has to run as a Stakeholder or Reader, so ${commit} gets no status. Log in as one in the browser the test opens.`);
  process.exit(1);
}

execFileSync(
  "gh",
  [
    "api",
    "--method",
    "POST",
    `repos/andersmoldin/Waypoint/statuses/${commit}`,
    "-f",
    "state=success",
    "-f",
    "context=e2e-testorg",
    "-f",
    "description=Playwright against the test organization as a Stakeholder",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

console.log(`${commit} now has the status e2e-testorg. Tag it to release it.`);
