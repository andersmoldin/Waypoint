# Security audit

The review before Waypoint's first public release, from 2026-11-06. It covers commit `3cca134` and what the review led to. The only later change on `main`, `3143b78`, concerns the hub's menu icon and was not reviewed separately.

**Who reviewed.** Four independent AI reviewers, working read-only and without seeing each other's results. No external human auditor has reviewed Waypoint. The owner decided every question of risk. Accepted findings say so, with the date of the decision.

**In short.** No way was found to run code in the page through work item data, settings, links or other frames. The serious findings were elsewhere: one work item could make the hub unusable for everyone who opened it, the release chain gave the unattended development build too much reach, and about 127 packages ran in the job that holds the publishing credential. Those are fixed. What remains is listed under [Accepted](#accepted-by-the-owner) and [For the owner to do](#for-the-owner-to-do).

## Method

| Reviewer | Scope | How |
| --- | --- | --- |
| ASVS | [OWASP ASVS 5.0](https://github.com/OWASP/ASVS/tree/master/5.0), all 70 Level 1 requirements, from the source text | Read all production code. Ran the built pages in Chromium and WebKit under a fake Azure DevOps host. |
| Azure DevOps and release | Scope, Extension Data Service, Content Security Policy, the SDK, WIQL, links, the package, the workflows, the release gate, Trusted Publishing, dependencies | Read the code, Microsoft's and GitHub's documentation and the public repository settings. Ran the packaged pages, a tampered package and the release scripts against stubs. |
| Hostile HTML | Fields of type html and every other path from a work item to the page | 236 hostile payloads, in 2,124 runs through the real code in Chrome, with the real policy and without it, and with positive controls that show the payloads do work as real HTML. WebKit and jsdom for differences. |
| `/security-review` | The whole repository, since the branch had no diff of its own | Claude Code's command, with its own filter for false positives. It reported nothing at confidence 8 or above. The one candidate it filtered out is ADO-1 below. |

The reviewers did not touch a real Azure DevOps organization or the Marketplace. The repository settings mentioned below were read through GitHub's API.

## Fixed

| Id | Severity | Finding | What was done |
| --- | --- | --- | --- |
| HTML-1 | High | A value in one rich text field could leave the whole hub blank for everyone, with no message. | Rich text is read without building a tree. A value that cannot be read costs that field. The hub has an error boundary that says what happened and keeps the gear. |
| HTML-2, ASVS-4 | High | A small value in one rich text field could freeze or crash the viewer's page on every load. | Rich text is read by a scanner whose time follows the length of the text. Only text can come out of it. Decided by the owner on 2026-11-06, replacing the earlier design of reading text nodes from a parsed document. |
| ADO-1 | High | The unattended development flow could probably reach the public extension, since a publishing credential is asked for by publisher. | `waypoint-dev` moved to a publisher of its own, `andersmoldin-dev`. Decided by the owner on 2026-11-06. On 2026-11-09 the owner created that publisher, with its Trusted Publishing policy for `publish-dev.yml` and the environment `waypoint-dev`, and removed the old development policy and the extension `andersmoldin.waypoint-dev` from the publisher `andersmoldin`. |
| ADO-2 | High | A compromised package among those the publishing tool loads, about 127 of them, would have run in the job that holds the publishing credential. | The job runs no npm package, only `curl`, `jq` and `unzip` from the runner and two pinned GitHub actions. The package set was evaluated first: no version in a known-bad range. Decided by the owner on 2026-11-06. It relies on calls Microsoft does not document, so a change shows as a red run. |
| ADO-3 | Medium | Release tags were not protected, and administrators could bypass the review of a release. | The owner protected release tags against being created, moved or deleted, and turned off the bypass, on 2026-11-09. |
| ADO-4 | Medium | Dependencies' install scripts ran everywhere, although nothing needs them. | `ignore-scripts=true` in `.npmrc`. |
| ADO-5 | Medium | The check of a built package looked only at identity and visibility, and ran only in the job that builds it. | `scripts/verifyVsix.sh` also checks the scope, the pages, the Content Security Policy and the list of files. It runs again before any credential exists, against the file's checksum. The checksum is shown on the page where the owner approves. |
| ADO-8 | Medium | The documents said the Content Security Policy blocks all calls to other hosts. It does not stop everything. | `SECURITY.md` and `PRIVACY.md` now say what it covers and what it does not. |
| ADO-9 | Medium | Private vulnerability reporting was off, although `SECURITY.md` sent reporters there. | The owner turned it on, on 2026-11-09. `SECURITY.md` also says what to do if the form does not work. |
| ASVS-3, ADO-10 | Low | A settings document without limits could freeze the hub and the panel that repairs it, or start thousands of requests. | Upper limits in the parser, linear parsing, at most six batches at a time, and the panel saves nothing the hub cannot read back. A document that no panel saves, such as one with empty tabs, now counts as damaged, so the panel offers the reset. |
| ASVS-5 | Low | Security and privacy text was wrong or incomplete in places. | Corrected. |
| ASVS-7, HTML-6 | Low | A value of an unexpected type could leave the hub on "Loading…" or blank. | Such values are ignored or shown as what they hold, and every failure ends in a message. |
| HTML-3 | Low | A long "Waiting on" could push the rest of a column out of view. | At most two lines on the card, and all of it in the panel. Decided by the owner on 2026-11-06. |
| HTML-4 | Low | Some text could be hidden from the board, and some text not meant for reading was shown. | Fixed by the new reader. |
| ADO-12 | Low | The documents said Azure DevOps offers no way to protect settings. A store with server-side checks exists, with a broader scope. | Reworded. The owner chose to stay with one scope, see ASVS-1. |
| ADO-13 | Low | The publish script could fall back to an unrelated npm package if the tool was missing. | The publish script no longer uses npm. |
| ADO-14 | Low | The documented fallback for publishing shared one identity between the two flows. | One identity per publisher. |
| ADO-15 | Low | A release build used the npm cache, and new versions could reach a merge the same week they came out. | No cache in a release build. Dependabot waits a week, except for security updates. |
| ADO-16 | Low | There was no plan for a harmful version that had already been released. | Added to [`docs/publicering.md`](docs/publicering.md). |
| ADO-18 | Info | The extension could be installed in Azure DevOps Server, which it does not support. | It installs only in Azure DevOps Services. |
| ADO-21 | Info | Statements about publishing were out of date. | Corrected. |
| HTML-9 | Info | The tests ran only in jsdom, which behaves differently from a browser for this kind of input. | `npm run browser` runs the real hub in real Chrome on every pull request. |

## Accepted by the owner

| Id | Severity | Risk | Decision |
| --- | --- | --- | --- |
| ASVS-1 | Medium | Settings are protected only in the browser. Anyone who can open the hub can technically change them for any project. | Accepted on 2026-11-06. Waypoint stays with Extension Data Service and one scope. A store with server-side checks would need a broader scope. Limits, error messages that repeat nothing from the document, and a line on the board when hidden groups hide everything reduce the effect. |
| ADO-6 | Medium | `vso.work` also covers service hook subscriptions, according to Microsoft's documentation, so a compromised release run by a Project Administrator could send events out server-side. No narrower scope lets the hub do what it does, and Microsoft gives no advice on this situation. | Accepted on 2026-11-06, and stated in `SECURITY.md` with what an administrator can check. |
| ASVS-2, ADO-7 | Medium | Settings and the change log, with names of whoever saved, can very likely be read across projects. Not tried against a real organization. | Accepted on 2026-11-06, and stated in `SECURITY.md` and `PRIVACY.md`. |
| ASVS-6 | Low | There are no promised times for fixes. The project is run by one private person, without guarantees. ASVS V15.1.1 and V15.2.1 therefore fail. | Accepted on 2026-11-06, and stated in `SECURITY.md`. |
| HTML-4 | Low | Text hidden with CSS in a rich text field shows on the board. | Accepted on 2026-11-06, and stated in [`docs/kanda-granser.md`](docs/kanda-granser.md). |
| HTML-5 | Low | Text from a work item can mislead, with invisible characters or characters that reverse its direction. The accessible name of a card holds free text. | Accepted on 2026-11-06, and stated in `SECURITY.md` and `docs/kanda-granser.md`. |
| ADO-4 | Medium | The owner's computer is part of what must be trusted for a release. | Accepted on 2026-11-06. |
| ADO-5 | Medium | The public package is not the file that was tested: the end-to-end test runs the development build of the same commit. A compromised build dependency could add code before the checksum is taken, and the owner's approval cannot see that. | Accepted on 2026-11-06. |
| ADO-8, ASVS-9 | Medium | If code ever got into the page, the Content Security Policy would not stop all of what it could do. No way in has been found. | Accepted on 2026-11-06, and stated in `SECURITY.md`. |
| ASVS-8, ADO-19 | Info | The extension trusts its parent frame, which is how the SDK works. A hostile parent gets no credentials, but can show false data. | Accepted on 2026-11-06. |
| HTML-3 | Low | A board where thousands of objects have fields of hundreds of kilobytes is slow to open. The hub does not cut the text. | Accepted on 2026-11-06, and stated in `docs/kanda-granser.md`. |
| ASVS-6 | Low | React 16 is an old major version, required by `azure-devops-ui`. `npm audit` reports no advisory for it today. | Accepted on 2026-11-06, and stated in `SECURITY.md`. |
| ASVS-6 | Low | `npm audit` reports 14 moderate advisories in build tools, which are not shipped. | Accepted on 2026-11-06. |
| ADO-3 | Medium | More than one account has write access to the repository. The rules on `main` and on tags limit what they can do. | Accepted on 2026-11-06. |

## For the owner to do

These are settings only the owner can change. The commands are in [`docs/publicering.md`](docs/publicering.md).

| Id | Severity | What |
| --- | --- | --- |
| ADO-11, ASVS-6 | Low | Make the security scans required for a merge, decided by the owner on 2026-11-06. The same command also requires the browser checks. |
| ADO-11 | Low | Dependabot's job for the pinned Semgrep image fails (`dependency_file_not_supported`), so that image is not updated by itself. It affects only what the scan finds. A separate task. |

## Looked at, nothing to change

| Id | Finding |
| --- | --- |
| ASVS-9 | `style-src 'unsafe-inline'` is needed by the library and the SDK, and no stored value reaches CSS. |
| HTML-7 | Parsing hostile HTML used to report to the page's policy. The new reader builds no tree. The policy must not get a reporting address. |
| HTML-8 | A tag or picklist value becomes part of a DOM id, reduced to safe characters by the library. |
| ADO-17 | The check behind the gear uses an endpoint not documented for `vso.work`. It fails closed: no gear, and a visible warning. |
| ADO-20 | All of a publisher's extensions may share one web origin. The development extension's own publisher removes the overlap. |

## OWASP ASVS 5.0, Level 1

After the fixes: **17 pass, 6 fail and are accepted, 47 do not apply.** Most of what does not apply is what Azure DevOps does for the extension, such as signing in, sessions and tokens.

| Requirement | Result | Why |
| --- | --- | --- |
| V1.2.1 | Pass | Untrusted text reaches the DOM only as React text or attributes; no untrusted data in CSS (group colours come from a fixed list). |
| V1.2.2 | Pass | The one hand-built URL uses `new URL` and `searchParams`; route values use `encodeURIComponent`; no link or navigation is built from data. |
| V1.2.3 | Pass | JSON only through `JSON.stringify`; no JavaScript is generated; CI's JSON override uses a validated version. |
| V1.2.4 | Pass | WIQL is the only query language: quotes are doubled in `flatQueryForType`, and types are allow-listed first. |
| V1.2.5 | N/A | No OS calls at runtime; browser only. Dev scripts use argument arrays. |
| V1.3.1 | Pass | No sanitiser, because rich text is never rendered: only its text is taken out (`src/board/htmlText.ts`). |
| V1.3.2 | Pass | No `eval` in `src/`. The bundle has only static `Function("return this")` fallbacks, and the CSP blocks eval. |
| V1.5.1 | N/A | No XML parsing; `DOMParser` is used only with `text/html`. |
| V2.1.1 | Pass | Link rules and the limits on settings are in `docs/kanda-granser.md`; settings rules are in `src/settings/settings.ts`. |
| V2.2.1 | Pass | Structure, allow-lists and upper limits are checked in `parseSettingsDocument`; non-text link values are ignored; rich text is read in time that follows its length. |
| V2.2.2 | Fail, accepted | Settings are validated only in the reading browser, since no trusted layer exists to check a write (ASVS-1). |
| V2.3.1 | N/A | No multi-step flows; saving is one step with optimistic concurrency. |
| V3.2.1 | N/A | Serves no dynamic or user content; static files with headers the project does not control; direct open only shows an error. |
| V3.2.2 | Pass | React text nodes. |
| V3.3.1 | N/A | Sets no cookies (bundle count 0, empty at runtime). |
| V3.4.1 | N/A | No server of its own; HSTS is Microsoft's (section 4). |
| V3.4.2 | N/A | No server of its own, so no CORS policy. |
| V3.5.1 | N/A | No endpoint of its own; calls use a bearer token and `credentials: same-origin` (the API client). |
| V3.5.2 | N/A | No endpoint of its own. |
| V3.5.3 | Pass | The only state change is `PUT` ; reads use `GET`, or `POST` where the API defines it (`wiql`, `workitemsbatch`). |
| V4.1.1 | N/A | Produces no HTTP responses; the CDN's headers were not verified; pages declare `<meta charset>`. |
| V4.4.1 | N/A | No WebSocket in the bundle. |
| V5.2.1 | N/A | No file upload. |
| V5.2.2 | N/A | No file upload. |
| V5.3.1 | N/A | No file storage. |
| V5.3.2 | N/A | No file paths. |
| V6.1.1 | N/A | Azure DevOps authenticates users. |
| V6.2.1 | N/A | No passwords. |
| V6.2.2 | N/A | No passwords. |
| V6.2.3 | N/A | No passwords. |
| V6.2.4 | N/A | No passwords. |
| V6.2.5 | N/A | No passwords. |
| V6.2.6 | N/A | No password fields. |
| V6.2.7 | N/A | No password fields. |
| V6.2.8 | N/A | No passwords. |
| V6.3.1 | N/A | Azure DevOps authenticates users. |
| V6.3.2 | N/A | No accounts of its own. |
| V6.4.1 | N/A | No credentials issued. |
| V6.4.2 | N/A | No credential recovery. |
| V7.2.1 | N/A | Azure DevOps verifies tokens. |
| V7.2.2 | Pass | Tokens come from `SDK.getAccessToken()` for each call; no static key in the repo or bundle (`git grep` patterns; `p/secrets` in CI). |
| V7.2.3 | N/A | Azure DevOps issues sessions. |
| V7.2.4 | N/A | Azure DevOps issues sessions. |
| V7.4.1 | N/A | Azure DevOps ends sessions. |
| V7.4.2 | N/A | Azure DevOps manages accounts. |
| V8.1.1 | Pass | `SECURITY.md` and `PRIVACY.md` now state who can read and write the settings (ASVS-2, ASVS-5). |
| V8.2.1 | Fail, accepted | Writing settings is limited only by a hidden gear (ASVS-1). |
| V8.2.2 | Fail, accepted | Work items are enforced by Azure DevOps with the viewer's token, but settings documents are open across projects (ASVS-1, ASVS-2). |
| V8.3.1 | Fail, accepted | The settings rule lives only in client JavaScript (ASVS-1). |
| V9.1.1 | N/A | Passes the token through; never decodes or trusts it. |
| V9.1.2 | N/A | Same. |
| V9.1.3 | N/A | Same. |
| V9.2.1 | N/A | Same. |
| V10.4.1 | N/A | Not an authorization server. |
| V10.4.2 | N/A | Not an authorization server. |
| V10.4.3 | N/A | Not an authorization server. |
| V10.4.4 | N/A | Not an authorization server. |
| V10.4.5 | N/A | Not an authorization server. |
| V11.3.1 | N/A | No cryptography (`crypto` count 0 in the bundle). |
| V11.3.2 | N/A | No cryptography. |
| V11.4.1 | N/A | No cryptographic hashing. |
| V12.1.1 | N/A | TLS configuration is Microsoft's. |
| V12.2.1 | Pass | The CSP allows only `https` hosts; `http://dev.azure.com` was blocked. |
| V12.2.2 | N/A | Certificates are Microsoft's. |
| V13.4.1 | Pass | The vsix listing holds no source control metadata. |
| V14.2.1 | Pass | The token is only in a header. The URL holds keyword and filter values, documented and not credentials (privacy note in ASVS-5). |
| V14.3.1 | Pass | No client storage; data lives only in the frame's memory and DOM. Behaviour at a real logout was not tested. |
| V15.1.1 | Fail, accepted | No time frames: the project is run by one private person, without promises (ASVS-6). |
| V15.2.1 | Fail, accepted | Measured against time frames, which there are none of (ASVS-6). `npm audit --omit=dev` is clean. |
| V15.3.1 | Pass | `workitemsbatch` asks for an explicit field list; only `id` and `fields` are kept; from the user only `id` and `displayName`. |

## What this review could not verify

Everything about the real Azure DevOps host comes from Microsoft's documentation and a fake host written from reading the SDK. Not tried:

- Whether a Reader can read and write another project's settings through the real service, and how large a document it accepts.
- Whether Azure DevOps stores hostile markup in a rich text field unchanged. The new reader does not depend on it.
- The real frame's `sandbox` attributes, and the real headers on the extension's files.
- Whether a publishing credential is limited per extension. The design assumes it is not.
- Firefox, and Edge as such. Chrome and WebKit were run, and WebKit is not Safari.
