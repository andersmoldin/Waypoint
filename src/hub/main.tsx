import "azure-devops-ui/Core/override.css";
import React from "react";
import ReactDOM from "react-dom";
import { createAzureDevOpsPlatform } from "../platform/azureDevOpsPlatform";
import { Hub } from "./Hub";

ReactDOM.render(<Hub platform={createAzureDevOpsPlatform()} />, document.getElementById("root"));
