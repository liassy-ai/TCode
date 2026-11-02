import type { PiBackend } from "@tcode/backend";
import { DRAFT_CHANNELS } from "@tcode/shared";
import { registerInvokeHandlers } from "./invoke";

export function registerDraftIpc(backend: PiBackend): void {
	registerInvokeHandlers(DRAFT_CHANNELS, {
		polishDraft: ({ sessionId, text }) => backend.polishDraft({ sessionId, text }),
	});
}
