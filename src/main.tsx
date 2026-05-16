import "./lib/crypto-polyfill";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initDevReactScan } from "./lib/dev-react-scan";
import { installFrontendLogCapture } from "./lib/frontend-logs";

installFrontendLogCapture();
initDevReactScan();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
