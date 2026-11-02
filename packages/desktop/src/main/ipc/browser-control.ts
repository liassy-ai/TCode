import { BROWSER_CONTROL_CHANNELS } from "@tcode/shared";
import { settleBrowserControl } from "../browser-control";
import { invokeGuest } from "../browser-guest";
import { registerInvokeHandlers } from "./invoke";

export function registerBrowserControlIpc(): void {
	registerInvokeHandlers(BROWSER_CONTROL_CHANNELS, {
		respondBrowserControl: ({ id, result }) => settleBrowserControl(id, result),
		invokeBrowserGuest: (payload) => invokeGuest(payload),
	});
}
