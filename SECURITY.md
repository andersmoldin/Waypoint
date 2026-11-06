# Security

Waypoint is a read-only hub for Azure Boards. It asks for one scope, `vso.work`, and never writes to work items.

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the latest review and what came of it.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's vulnerability reporting](https://github.com/andersmoldin/Waypoint/security/advisories/new), not in a public issue. Describe what an attacker can do, which version you tested and how to reproduce it.

Waypoint is run by one private person, on a best-effort basis and without guarantees. There are no promised times for answering a report, for fixing a vulnerability or for updating a dependency. Only the latest version on the Visual Studio Marketplace gets fixes. Weigh this before you install Waypoint.

## Known limitations

Read these before you install Waypoint. The limitations on settings come from how Waypoint stores them: Extension Data Service is what an extension can use with no scope beyond `vso.work`, and it cannot protect them. A store with protection would need a broader scope, which Waypoint has chosen not to ask for.

### Settings are not protected in storage

The hub's settings and their change log are stored in Extension Data Service, under one key per project. Extension Data Service has no project scope and cannot limit who reads or writes. Everyone who can open the hub, including Stakeholders and Readers, can technically read and write the settings of any project in the organization, for example with a script in the browser. This has not been tried against a real organization. It follows from Microsoft's documentation, so assume it holds.

Someone who does this can:

- read the settings and change log of every project, also projects they have no other access to: phase, tab and filter names, field names, tags that have been unticked, hidden group ids, and the display name and user id of whoever saved
- change what the hub shows: which phases, tabs, fields and filters appear, and which groups are hidden
- put their own words in the hub, as the names of tabs, dividers and filters
- make the hub unusable for a project until a Project Administrator resets the settings

They cannot change work items, and they cannot read work items that their own Azure DevOps permissions do not already allow.

### The gear is only hidden in the user interface

The gear that opens the settings is shown only to users with the project permission "Edit project-level information", which by default only administrators have. This is a convenience that prevents mistakes, not access control, because storage does not enforce it.

### The settings log is unverified

Every change made through the settings panel is logged with who and when. The log keeps the latest 500 changes, so the oldest entries eventually go. The browser writes the log to the same unprotected storage, so anyone who can write the settings can also forge, change or delete log entries. Use the log to find and correct honest mistakes, not as an audit trail. It says who and when, not what changed.

### The Content Security Policy is a second layer, not a guarantee

Waypoint's code calls no other host than Azure DevOps. The hub page and the settings panel also have a Content Security Policy, which makes the browser block the page's fetches, images, styles, fonts, frames and forms to any host other than Azure DevOps (`dev.azure.com`, `*.dev.azure.com` and `*.visualstudio.com`).

The policy matters only if someone gets code into the page, and no way to do that has been found. It would not stop such code from everything:

- All organizations share these hosts, so the policy cannot tell your organization from another one. The code could send data to an organization of the attacker's own.
- A policy in a page cannot stop the page from navigating its own frame, from opening a window on a click, or from using WebRTC.
- It has no effect on what the code asks Azure DevOps to do on the server.

So what you rely on is the code and the way it is released, not the policy alone.

### Text from work items can mislead

Text is always shown as text, never as HTML. It is shown as it stands, so someone who can edit a work item can make its text say what they like, including with invisible characters, characters that reverse the direction of the text, and text a rich text editor would hide. See [known limits](docs/kanda-granser.md#text-som-kan-vilseleda), in Swedish.

## How the project checks itself

Every pull request and merge to `main`, and a weekly schedule, runs CodeQL, Semgrep and `npm audit` (see [`.github/workflows/security.yml`](.github/workflows/security.yml)). Every pull request also runs the real hub in real Chrome against hostile input (see [`browser/hub.spec.ts`](browser/hub.spec.ts)). Dependabot proposes dependency updates, a week after a version comes out unless it is a security update (see [`.github/dependabot.yml`](.github/dependabot.yml)).

React 16 is an old major version. `azure-devops-ui`, the library Azure DevOps offers for this kind of user interface, requires it. `npm audit` reports no advisory for it today.
