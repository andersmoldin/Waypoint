# Vision

`Waypoint` exists so that people who follow long-lived work in Azure Boards can see, in one view, which phase every work item is in, which group it belongs to and whether it is waiting for something.
It serves stakeholders outside the team, including those with only a Stakeholder or Reader license, and the Project Administrators who set the board up for their project.
It turns the work items of one type and a picklist field of the administrator's choice into a board with one column per phase.
It owns exactly one thing: a read-only view of where each work item is in its lifecycle, with one lifecycle board per project and the hub in Boards as its home.

## A tool for seeing, with one scope

Waypoint is first of all a tool for seeing information, so being read-only is what it is, not a limit of its first version.
It never writes to work items, and no feature needs a scope other than `vso.work`.
A capability that needs a broader scope is refused even when that scope would do it better, which is why the settings stay unprotected in Extension Data Service.
`vso.work` reaches further than reading, so Waypoint calls only the APIs it needs to show the board, and never the service hook API.
A Stakeholder or Reader sees everything an administrator sees except the gear, and no feature needs a paid license.
The publisher carries personal, uncapped liability under the Marketplace agreement, so low permission outranks capability.

## The organisation's data stays in Azure DevOps

Waypoint collects nothing: no telemetry, no analytics, and no call from its code to any host other than Azure DevOps.
Information reaches the owner only when a user actively contacts them and sends it themself, for example through a button that opens a pre-filled GitHub issue they read first.
Nothing leaves in the background, and no setting, not even an administrator's, turns on reporting.
Work items are read fresh each time the hub opens and are never stored or cached.
Every visit starts with the default view, and a view is kept only as a link that can be shared or bookmarked, so Waypoint stores nothing per user.
The only thing Waypoint stores is each project's settings and their change log, in the organisation's own Extension Data Service.
Text from work items reaches the page as text and never as HTML, and rich text is read by a linear reader that builds no tree.
Organisation data is shown as written: it is never translated, cleaned or reinterpreted.
The user interface and the Marketplace listing are in English, and letting each user choose another interface language is welcome.

## Generic, set up per project, built when asked for

Everything specific to an organisation is a setting a Project Administrator chooses per project: types, phase field and order, tabs, card roles, detail fields, filter fields and hidden groups.
The owner's own organisation is the first user and the example, and its needs are welcome when they are built as generic settings, such as a rule that shows the names in titles clearly on cards.
The group is always the work item's parent: Waypoint is for projects structured as parent and child, and grouping by a field such as Area Path is refused.
Until it is set up, the hub guesses Features under Epics and the first picklist field, and says that it is guessing.
Anyone who can open the hub can write the settings, so every setting is hostile input: it is validated, bounded, rejected visibly when invalid, and never repeated in an error.
A new setting earns its place only when it is safe to accept from any viewer.
Lifecycle information that `vso.work` can read, such as how long a work item has been in its phase, is welcome on the board.
Features are added when users ask for them, not ahead of need.
The hub is built on what Microsoft provides and recommends for extensions, `azure-devops-ui`, `azure-devops-extension-sdk` and `azure-devops-extension-api`, and Waypoint follows them rather than replacing them, even when that keeps an old React.

## Visible limits, not silent failure

A board is never cut silently: past 2,000 work items it shows the first 2,000 by group with the real total, and past what Azure DevOps will answer it shows the error instead of an incomplete board.
Invalid settings, unusable fields and unreadable values give a visible message and a way back, and the rest of the board stays up.
Every known limit and accepted risk is written where an installer reads it: `SECURITY.md`, `SECURITY_AUDIT.md`, `PRIVACY.md`, `ACCESSIBILITY.md` and `docs/kanda-granser.md`.
A change that adds a limit or accepts a risk documents it in the same pull request, and a new risk needs the owner's acceptance.
Waypoint is one private person's project, run on a best-effort basis, and it promises no response or fix times.

## Accessible, and tested as a user uses it

The hub meets WCAG 2.2 AA: axe-core finds no violations in the tests and in real Chrome, the main paths work from the keyboard, and color is never the only signal.
`ACCESSIBILITY.md` says what has been verified, by whom and how, and what has not, and a change to what a keyboard or screen reader user meets updates it.
Tests render the hub and act as a user against the one platform adapter, and the SDK is mocked nowhere else.
Every pull request runs the real hub in real Chrome against hostile input.
Waypoint supports only what the owner can try and test, and a change for a host the owner cannot run is resisted however complete it is.

## Behaviour that must not change silently

A change to anything in this section goes to the owner, even when it looks like an improvement.
The public extension is released only by a tag `vYYYY.M.N` that the owner creates on a commit on `main`, and the ruleset "Skydda release-taggar" lets only a repository admin create, move or delete a `v*` tag.
The release version is CalVer `YYYY.M.N`, taken only from the tag by `scripts/versionFromTag.ts`: a four-digit year, the month from 1 to 12, and N counting that month's releases from 0, with no leading zeros and no suffix, for example `v2026.11.3`.
The version exists nowhere else: `vss-extension.json` and `package.json` hold the placeholder `0.0.0`, and the workflow writes the tag's version into the package with `tfx --override`.
No workflow creates, moves or derives a tag or a version, and a pull request's title type (`feat`, `fix`, `!`) never sets one.
`publish-public.yml` publishes only after `scripts/releaseGate.sh` passes and the owner approves the run in the environment `marketplace`.
The gate refuses unless the commit is on `main`, `marketplace` has a required reviewer, the commit's newest `e2e-testorg` status is green and set by `andersmoldin`, and `SECURITY_AUDIT.md` and `ACCESSIBILITY.md` exist.
The owner sets `e2e-testorg` by running `npm run e2e` on that commit against the test organisation, because the hub needs a signed-in web session that CI must not hold.
Every push to `main` publishes the private development build through `publish-dev.yml`, without approval, as `YYYY.M.<run number>`: the year and month in UTC at build time and the workflow's run number.
The public extension is `andersmoldin.waypoint-board`, shown as "Waypoint", and the development extension is `andersmoldin-dev.waypoint-dev`, under its own publisher so the unattended flow cannot reach the public one.
Publishing stores no secret and never uses a PAT: it uses Marketplace Trusted Publishing over OIDC, and the job that can obtain a credential runs no npm package and checks the vsix with `scripts/verifyVsix.sh` first.
The package asks for exactly `vso.work`, targets only Azure DevOps Services, and holds only the files `scripts/verifyVsix.sh` allows.
Saved settings stay readable: they live in Extension Data Service under the extension's publisher and id, one document per project, so every release reads every document an earlier release saved.
Shared links keep working: the `tab`, `keyword`, `group` and `filter.<name>` parameters keep their names and meaning.

## Scope

Waypoint is not a work item editor: it changes no phase, field or link, and it has no gates or decisions between phases.
It is not a builder of several boards per project, not an Azure DevOps Server extension and not a cache.
It is not a reporting tool: lead times, burndown and other measures over time stay out.
Other read-only views of the same lifecycle, such as a delivery plan, may join the hub when they let the administrator shape the view more than Azure Boards' own Delivery Plans do.
A dashboard widget that shows the same lifecycle, such as the count per phase, is welcome when nothing technical stands in the way.
It is made for the large screens where Azure DevOps is mostly used, and a phone layout comes only when users ask for it.
It is not access control: hidden groups and the hidden gear are choices of view, not protection.
Real organisation data stays out of the repository: tests, screenshots and the listing use invented data.
Every change reaches `main` through a reviewed pull request with every required check green, and no one bypasses that.

A change aligns when it makes the phase board clearer, more accessible, more robust or safer for the people who read it, within `vso.work`, and without storing or sending anything new.
A change should be resisted when it writes to Azure DevOps, needs a broader scope, sends anything to another host without the user's own action, stores work item data or anything per user, reports measures over time, groups by anything but the parent, hard-codes one organisation, hides a limit, or alters anything under "Behaviour that must not change silently" without the owner's yes.
