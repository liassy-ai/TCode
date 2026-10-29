import type { AnyChannelDef, InvokeHandlers } from "@tcode/shared";
import { ipcMain } from "electron";

export const invokeRegistry = new Map<string, (args: unknown) => unknown>();

export function registerInvokeHandlers<T extends Record<string, AnyChannelDef>>(
	table: T,
	handlers: InvokeHandlers<T>,
): void {
	for (const [key, def] of Object.entries(table) as [keyof T & string, AnyChannelDef][]) {
		const handler = handlers[key] as (args: unknown) => unknown;
		invokeRegistry.set(def.channel, handler);
		ipcMain.handle(def.channel, (_e, args) => handler(args));
	}
}
