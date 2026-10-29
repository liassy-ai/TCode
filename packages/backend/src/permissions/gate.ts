import type { PermissionAnswer, PermissionRequest, PermissionRequestKind } from "@tcode/shared";

export type PermissionResponder = (req: PermissionRequest) => void;

export interface PermissionRequestMeta {
	kind: PermissionRequestKind;

	suggestDir?: string;
}

let nextId = 0;

export class PermissionGate {
	private readonly pending = new Map<
		string,
		{ resolve: (answer: boolean) => void; message: string; meta?: PermissionRequestMeta }
	>();
	private readonly titles = new Map<string, string>();
	private readonly alwaysAllowed = new Set<string>();

	private sessionId = "";

	constructor(private readonly onRequest: PermissionResponder) {}

	bindSession(sessionId: string): void {
		this.sessionId = sessionId;
	}

	confirm(title: string, message: string, meta?: PermissionRequestMeta): Promise<boolean> {
		if (this.alwaysAllowed.has(title)) {
			return Promise.resolve(true);
		}
		const id = `perm-${this.sessionId}-${nextId++}`;
		return new Promise<boolean>((resolve) => {
			this.pending.set(id, { resolve, message, meta });
			this.titles.set(id, title);
			this.onRequest({
				id,
				sessionId: this.sessionId,
				title,
				message,
				kind: meta?.kind ?? "other",
				suggestDir: meta?.suggestDir,
			});
		});
	}

	getRequest(requestId: string): { title: string; meta?: PermissionRequestMeta } | undefined {
		if (!this.pending.has(requestId)) return undefined;
		return { title: this.titles.get(requestId) ?? "", meta: this.pending.get(requestId)?.meta };
	}

	listPending(): PermissionRequest[] {
		return [...this.pending.entries()].map(([id, entry]) => ({
			id,
			sessionId: this.sessionId,
			title: this.titles.get(id) ?? "",
			message: entry.message,
			kind: entry.meta?.kind ?? "other",
			suggestDir: entry.meta?.suggestDir,
		}));
	}

	getSessionId(): string {
		return this.sessionId;
	}

	respond(requestId: string, answer: PermissionAnswer): void {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		const title = this.titles.get(requestId) ?? "";
		this.pending.delete(requestId);
		this.titles.delete(requestId);
		if (answer === "allowAlways" && title) {
			this.alwaysAllowed.add(title);
		}
		entry.resolve(answer === "allow" || answer === "allowAlways" || answer === "allowDir");
	}

	dispose(): void {
		for (const { resolve } of this.pending.values()) resolve(false);
		this.pending.clear();
		this.titles.clear();
	}
}
