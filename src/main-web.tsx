import "./App.css";
import "./lib/crypto-polyfill";
import React from "react";
import ReactDOM from "react-dom/client";
import WebApp from "./web/app";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<WebApp />
	</React.StrictMode>,
);
