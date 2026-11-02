import type { PiBackend } from "@tcode/backend";
import { IpcChannels, MCP_CHANNELS } from "@tcode/shared";
import { registerInvokeHandlers } from "./invoke";

export function registerMcpIpc(backend: PiBackend, send: (channel: string, payload: unknown) => void): void {
	registerInvokeHandlers(MCP_CHANNELS, {
		getMcpConfig: ({ cwd }) => backend.getMcpConfig({ cwd }),
		upsertMcpServer: (input) => backend.upsertMcpServer(input),
		removeMcpServer: ({ scope, cwd, name }) => backend.removeMcpServer({ scope, cwd, name }),
		reloadMcpServers: ({ cwd }) => backend.reloadMcpServers({ cwd }),
		getMcpRawConfig: ({ scope, cwd }) => backend.getMcpRawConfig({ scope, cwd }),
		saveMcpRawConfig: ({ scope, cwd, text }) => backend.saveMcpRawConfig({ scope, cwd, text }),
	});
	backend.onMcpServersChanged((payload) => send(IpcChannels.McpServersChanged, payload));
}
