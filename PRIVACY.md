# Privacy

Waypoint collects nothing. It has no telemetry and no analytics, and the publisher receives no data from your organization.

## What Waypoint reads and stores

- **Work items.** The hub reads work items through Azure DevOps, with the permissions of the person viewing it. They are read fresh each time the hub opens and are not stored.
- **Settings.** The hub's settings are stored in your own organization, in Azure DevOps Extension Data Service.
- **Who changed the settings.** Each settings change is logged there, with the display name and user id of whoever made it and when. The latest 500 changes are kept, with no time limit. Everyone who can open the hub can very likely read this log for every project in the organization, see [SECURITY.md](https://github.com/andersmoldin/Waypoint/blob/main/SECURITY.md). Whether Azure DevOps removes this data when the extension is uninstalled is not documented.
- **Links.** The tab and filter you choose are in the page's address, including the keyword you type, so they end up in your browser's history and in the links you share.

## Where your data goes

Nowhere other than Azure DevOps. Waypoint's code calls no other host, and the hub page has a Content Security Policy that makes the browser block the page's fetches to other hosts. See [SECURITY.md](https://github.com/andersmoldin/Waypoint/blob/main/SECURITY.md) for what this does and does not cover.

## Microsoft

Waypoint runs on Azure DevOps and is distributed through the Visual Studio Marketplace. Microsoft's own terms and privacy statement apply to those services, including the install numbers Marketplace shows a publisher.

## Questions

Open an issue at <https://github.com/andersmoldin/Waypoint/issues>.
