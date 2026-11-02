import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { type McpToolView, parseMcpToolName } from "@tcode/shared";

export type McpInventoryReporter = (tools: Map<string, McpToolView[]>) => void;

function snapshot(tools: ReadonlyArray<{ name: string }>): Map<string, McpToolView[]> {
	const map = new Map<string, McpToolView[]>();
	for (const tool of tools) {
		const parsed = parseMcpToolName(tool.name);
		if (!parsed) continue;
		const list = map.get(parsed.server) ?? [];
		list.push({ name: tool.name });
		map.set(parsed.server, list);
	}
	for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	return map;
}

export function makeMcpInventoryExtension(report: McpInventoryReporter): InlineExtension {
	return {
		name: "mcp-inventory",
		builtin: true,
		hidden: true,
		factory: (pi: ExtensionAPI) => {
			let last = "";
			let disposed = false;
			const timers: ReturnType<typeof setTimeout>[] = [];
			const stopTimers = (): void => {
				for (const timer of timers) clearTimeout(timer);
				timers.length = 0;
			};
			const emit = (): void => {
				if (disposed) return;
				let map: Map<string, McpToolView[]>;
				try {
					map = snapshot(pi.getAllTools());
				} catch {
					disposed = true;
					stopTimers();
					return;
				}
				const signature = JSON.stringify([...map.entries()]);
				if (signature === last) return;
				last = signature;
				report(map);
			};
			pi.on("session_start", () => {
				emit();
				for (const delay of [600, 1800, 4000, 8000]) {
					timers.push(setTimeout(emit, delay));
				}
			});
			pi.on("session_shutdown", () => {
				disposed = true;
				stopTimers();
			});
			pi.on("before_agent_start", () => {
				emit();
			});
			pi.on("turn_end", () => {
				emit();
			});
			pi.on("mcp_servers_change", () => {
				emit();
			});
		},
	};
}
