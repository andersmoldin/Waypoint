import "azure-devops-ui/Core/override.css";
import React from "react";
import ReactDOM from "react-dom";
import { Hub } from "../hub/Hub";
import { createFakePlatform } from "../platform/fakePlatform";
import { LISTING_WORLD } from "./listingWorld";

// The real hub with invented data, for the Marketplace screenshots: scripts/generateScreenshots.ts.

ReactDOM.render(<Hub platform={createFakePlatform(LISTING_WORLD)} />, document.getElementById("root"));
