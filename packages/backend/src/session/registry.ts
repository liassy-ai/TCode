import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionMeta } from "@tcode/shared";
import type { PermissionModeRef } from "../permissions/extension";
import type { PermissionGate } from "../permissions/gate";
import type { ExtensionDialogHost } from "./extension-dialog-host";
import { deriveSessionTimes, fallbackSessionTimes } from "./meta";

export interface RegisteredSession {
	session: AgentSession;
	unsubscribe: () => void;
	cwd: string;

	readOnly?: boolean;

	gate: PermissionGate;

	dialogs: ExtensionDialogHost;

	modeRef: PermissionModeRef;
}

export class SessionRegistry {
	private readonly sessions = new Map<string, RegisteredSession>();

	add(entry: RegisteredSession): void {
		const existing = this.sessions.get(entry.session.sessionId);
		if (existing && existing !== entry) {
			throw new Error(`Session already registered: ${entry.session.sessionId}`);
		}
		this.sessions.set(entry.session.sessionId, entry);
	}

	get(sessionId: string): RegisteredSession | undefined {
		return this.sessions.get(sessionId);
	}

	has(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	delete(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (!entry) return;
		entry.unsubscribe();
		entry.gate.dispose();
		entry.dialogs.dispose();
		this.sessions.delete(sessionId);
	}

	list(): RegisteredSession[] {
		return [...this.sessions.values()];
	}

	toMeta(entry: RegisteredSession): SessionMeta {
		const { session, cwd } = entry;

		const times =
			deriveSessionTimes(session.sessionManager.getHeader(), session.sessionManager.getEntries()) ??
			fallbackSessionTimes(session.sessionFile);
		return {
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
			cwd,
			name: session.sessionName,
			modelLabel: session.model?.name,
			model: session.model ? { provider: session.model.provider, modelId: session.model.id } : null,
			thinkingLevel: session.thinkingLevel,
			active: true,
			messageCount: session.messages.length,
			createdAt: times.createdAt,
			modifiedAt: times.modifiedAt,
			readOnly: entry.readOnly || undefined,
		};
	}

	disposeAll(): void {
		for (const [sessionId, entry] of [...this.sessions.entries()]) {
			entry.unsubscribe();
			entry.gate.dispose();
			entry.dialogs.dispose();
			entry.session.dispose();
			this.sessions.delete(sessionId);
		}
	}
}

export type EventForwarder = (sessionId: string, event: AgentSessionEvent) => void;
