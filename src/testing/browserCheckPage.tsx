import "azure-devops-ui/Core/override.css";
import React from "react";
import ReactDOM from "react-dom";
import { fieldText } from "../board/fieldText";
import { Hub } from "../hub/Hub";
import { createFakePlatform, type FakeWorld } from "../platform/fakePlatform";
import { SettingsPanel } from "../settings/SettingsPanel";
import { CURRENT_SITUATION, LISTING_SETTINGS, LISTING_WORLD, PHASE_FIELD, PHASES, WAITING_ON } from "./listingWorld";

// The real hub and settings panel with invented data, for what only a real browser can show: browser/hub.spec.ts.

const SETTINGS = {
  ...LISTING_SETTINGS,
  tabs: [
    { name: "Before production", phases: [{ name: "Idea" }, { name: "Planning" }, { name: "Development" }] },
    { name: "In production", phases: [{ name: "Production" }, { name: "Paused" }] },
    { name: "Closing", phases: [{ name: "Retired", dividerBefore: "Never happened" }] },
  ],
  filterFields: [{ type: "filled", name: "Waiting", referenceName: WAITING_ON.referenceName, filledText: "Waiting", emptyText: "Not waiting" }],
};

const withSettings = (settings: Record<string, unknown>): FakeWorld => ({ ...LISTING_WORLD, savedSettings: { "project-1": { version: 1, settings, log: [{ at: Date.UTC(2026, 10, 2, 9), userId: "user-1", userName: "Ada Admin" }] } } });

const SCENARIOS: Record<string, FakeWorld> = {
  board: { ...withSettings(SETTINGS), isAdministrator: true },
  "from-a-link": { ...withSettings(SETTINGS), queryParams: { keyword: "invoices" } },
  "not-set-up": { ...LISTING_WORLD, savedSettings: {}, isAdministrator: true },
  "cannot-be-used": { ...LISTING_WORLD, savedSettings: { "project-1": { version: 99 } } },
  "field-gone": withSettings({ ...SETTINGS, roles: { currentSituation: "Custom.Gone" } }),
  "all-hidden": withSettings({ ...SETTINGS, hiddenGroups: [1, 2, 3] }),
};

const root = document.getElementById("root");
const scenario = new URLSearchParams(location.search).get("scenario") ?? "board";
if (scenario === "settings") {
  ReactDOM.render(<SettingsPanel platform={createFakePlatform({ ...withSettings(SETTINGS), isAdministrator: true })} />, root);
} else if (scenario !== "empty") {
  ReactDOM.render(<Hub platform={createFakePlatform(SCENARIOS[scenario])} />, root);
}

const FIELD = { ...CURRENT_SITUATION, referenceName: "f" };

/** What the checks reach from outside the page. */
Object.assign(window, {
  waypointChecks: {
    /** The real reading of a field of type html, as a card does it. */
    readHtml: (html: string) => fieldText({ id: 1, fields: { f: html } }, FIELD),
    /** The real hub with the value in every free text role of one card. */
    showBoardWith: (value: string) =>
      ReactDOM.render(
        <Hub
          platform={createFakePlatform({
            ...withSettings({ ...SETTINGS, detailFields: [CURRENT_SITUATION.referenceName, WAITING_ON.referenceName] }),
            workItems: [
              { id: 1, type: "Epic", fields: { "System.Title": "Invoicing" } },
              {
                id: 11,
                type: "Feature",
                fields: { "System.Title": "Scan incoming invoices", [PHASE_FIELD]: PHASES[0], "System.Parent": 1, [CURRENT_SITUATION.referenceName]: value, [WAITING_ON.referenceName]: value },
              },
              { id: 12, type: "Feature", fields: { "System.Title": "The next card", [PHASE_FIELD]: PHASES[0], "System.Parent": 1 } },
            ],
          })}
        />,
        root,
      ),
  },
});
