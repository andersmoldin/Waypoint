# Privacy

Waypoint collects nothing. It has no telemetry and no analytics, and the publisher receives no data from your organization.

## What Waypoint reads and stores

- **Work items.** The hub reads work items through Azure DevOps, with the permissions of the person viewing it. They are read fresh each time the hub opens and are not stored.
- **Settings.** The hub's settings are stored in your own organization, in Azure DevOps Extension Data Service. Each settings change is logged there with who made it and when.

## Where your data goes

Nowhere other than Azure DevOps. The hub page has a Content Security Policy that makes the browser block calls to any other host. See [SECURITY.md](https://github.com/andersmoldin/Waypoint/blob/main/SECURITY.md) for what this does and does not cover.

## Microsoft

Waypoint runs on Azure DevOps and is distributed through the Visual Studio Marketplace. Microsoft's own terms and privacy statement apply to those services, including the install numbers Marketplace shows a publisher.

## Questions

Open an issue at <https://github.com/andersmoldin/Waypoint/issues>.
