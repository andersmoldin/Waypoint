# Security

Waypoint is a read-only hub for Azure Boards. It asks for one scope, `vso.work`, and never writes to work items.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's vulnerability reporting](https://github.com/andersmoldin/Waypoint/security/advisories/new), not in a public issue. Describe what an attacker can do, which version you tested and how to reproduce it.

Waypoint is maintained by one person, so there is no guaranteed response time. Only the latest version on the Visual Studio Marketplace gets fixes.

## Known limitations

Read these before you install Waypoint. The limitations on settings follow from how the platform works, because Azure DevOps offers extensions no way to protect their settings.

### Settings are not protected in storage

The hub's settings are stored in Extension Data Service, under one key per project. Extension Data Service has no project scope and cannot limit who writes. Everyone who can open the hub, including Stakeholders and Readers, can technically write the settings of any project in the organization, for example with a script in the browser.

Someone who does this can change what the hub shows: which phases, tabs, fields and filters appear, and which groups are hidden. They cannot change work items or reach data that their own Azure DevOps permissions do not already allow.

### The gear is only hidden in the user interface

The gear that opens the settings is shown only to users with the project permission "Edit project-level information", which by default only administrators have. This is a convenience that prevents mistakes, not access control, because storage does not enforce it.

### The settings log is unverified

Every change made through the settings panel is logged with who and when. The log keeps the latest 500 changes, so the oldest entries eventually go. The browser writes the log to the same unprotected storage, so anyone who can write the settings can also forge, change or delete log entries. Use the log to find and correct honest mistakes, not as an audit trail.

### Calls are limited to Azure DevOps, not to your organization

The hub page and the settings panel have a Content Security Policy that makes the browser block calls to any host other than Azure DevOps (`dev.azure.com`, `*.dev.azure.com` and `*.visualstudio.com`). All organizations share these hosts, so the policy cannot tell your organization from another one.

## How the project checks itself

Every pull request and merge to `main`, and a weekly schedule, runs CodeQL, Semgrep and `npm audit` (see [`.github/workflows/security.yml`](.github/workflows/security.yml)). Dependabot proposes dependency updates (see [`.github/dependabot.yml`](.github/dependabot.yml)).
