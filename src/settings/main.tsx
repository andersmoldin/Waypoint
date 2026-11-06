import "azure-devops-ui/Core/override.css";
import React from "react";
import ReactDOM from "react-dom";
import { createAzureDevOpsPlatform } from "../platform/azureDevOpsPlatform";
import { SettingsPanel } from "./SettingsPanel";

ReactDOM.render(<SettingsPanel platform={createAzureDevOpsPlatform()} />, document.getElementById("root"));
