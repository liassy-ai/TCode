import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { QuitConfirmDialog } from "./components/ui/QuitConfirmDialog";
import "./plugins/host-api";
import "./lib/zoom-guard";
import { initSplash } from "./splash";
import { useThemeStore } from "./stores/theme";
import { useUiPreferencesStore } from "./stores/ui-preferences";
import "./styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element not found");

initSplash();

void Promise.all([useThemeStore.getState().init(), useUiPreferencesStore.getState().init()]).finally(() => {
	createRoot(root).render(
		<StrictMode>
			<AppErrorBoundary>
				<App />
			</AppErrorBoundary>
			<QuitConfirmDialog />
		</StrictMode>,
	);
});
