import "azure-devops-ui/Core/override.css";
import React from "react";
import ReactDOM from "react-dom";
import { Hub } from "../hub/Hub";
import { createFakePlatform, type FakeWorkItem } from "../platform/fakePlatform";

// The real hub with invented data, for the Marketplace screenshots: scripts/generateScreenshots.ts.

const PHASE_FIELD = "Custom.Phase";
const PHASES = ["Idea", "Planning", "Development", "Production", "Paused", "Retired"];

const group = (id: number, title: string): FakeWorkItem => ({ id, type: "Epic", fields: { "System.Title": title } });

const object = (id: number, title: string, phase: string, parent: number): FakeWorkItem => ({
  id,
  type: "Feature",
  fields: { "System.Title": title, [PHASE_FIELD]: phase, "System.Parent": parent },
});

const platform = createFakePlatform({
  savedSettings: {
    "project-1": {
      version: 1,
      settings: { objectType: "Feature", groupType: "Epic", phaseField: PHASE_FIELD, phaseOrder: PHASES },
      log: [],
    },
  },
  picklistFields: { Feature: [{ referenceName: PHASE_FIELD, name: "Phase", values: PHASES }] },
  workItems: [
    group(1, "Invoicing"),
    group(2, "Onboarding"),
    group(3, "Reporting"),
    object(11, "Scan incoming invoices", "Idea", 1),
    object(12, "Match invoices to orders", "Development", 1),
    object(13, "Send payment reminders", "Production", 1),
    object(14, "Archive paid invoices", "Paused", 1),
    object(21, "Create accounts for new hires", "Planning", 2),
    object(22, "Order equipment", "Idea", 2),
    object(23, "Send welcome letters", "Production", 2),
    object(24, "Print badges", "Planning", 2),
    object(31, "Monthly sales report", "Production", 3),
    object(32, "Inventory report", "Paused", 3),
    object(33, "Fax summary", "Retired", 3),
    object(34, "Quarterly forecast", "Idea", 3),
    object(35, "Audit extract", "Development", 3),
  ],
});

ReactDOM.render(<Hub platform={platform} />, document.getElementById("root"));
