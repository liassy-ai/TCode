import type {
	ExtensionDialogKind,
	ExtensionDialogQuestion,
	ExtensionDialogRequest,
	ExtensionDialogResolved,
	ExtensionDialogRespond,
} from "@tcode/shared";

export type ExtensionDialogResponder = (req: ExtensionDialogRequest) => void;

export type ExtensionDialogResolvedListener = (result: ExtensionDialogResolved) => void;

export interface ExtensionDialogFields {
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;

	questions?: ExtensionDialogQuestion[];
}

export interface ExtensionDialogOpts {
	signal?: AbortSignal;
	timeout?: number;
}

const CANCEL_VALUE: Record<ExtensionDialogKind, string | boolean | undefined> = {
	select: undefined,
	input: undefined,
	editor: undefined,
	confirm: false,
	form: undefined,
};

interface PendingEntry {
	request: ExtensionDialogRequest;
	resolve: (value: string | boolean | string[] | undefined) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
	signal: AbortSignal | undefined;
	onAbort: (() => void) | undefined;

	settled: boolean;
}

export class ExtensionDialogHost {
	private readonly pending = new Map<string, PendingEntry>();
	private sessionId = "";
	private seq = 0;

	constructor(
		private readonly listeners: {
			onRequest: ExtensionDialogResponder;
			onResolved: ExtensionDialogResolvedListener;
		},
	) {}

	bind(sessionId: string): void {
		this.sessionId = sessionId;
	}

	ask(
		kind: ExtensionDialogKind,
		fields: ExtensionDialogFields,
		opts?: ExtensionDialogOpts,
	): Promise<string | boolean | string[] | undefined> {
		const id = `dlg-${this.sessionId}-${this.seq++}`;
		const request: ExtensionDialogRequest = {
			id,
			sessionId: this.sessionId,
			kind,
			title: fields.title,
			...(fields.message !== undefined ? { message: fields.message } : {}),
			...(fields.options !== undefined ? { options: fields.options } : {}),
			...(fields.placeholder !== undefined ? { placeholder: fields.placeholder } : {}),
			...(fields.prefill !== undefined ? { prefill: fields.prefill } : {}),
			...(fields.questions !== undefined ? { questions: fields.questions } : {}),
			...(opts?.timeout !== undefined ? { timeoutMs: opts.timeout } : {}),
			requestedAt: Date.now(),
		};

		if (opts?.signal?.aborted) {
			this.listeners.onResolved({ sessionId: this.sessionId, requestId: id, reason: "aborted" });
			return Promise.resolve(CANCEL_VALUE[kind]);
		}
		return new Promise((resolve) => {
			const entry: PendingEntry = {
				request,
				resolve,
				timer: undefined,
				signal: opts?.signal,
				onAbort: undefined,
				settled: false,
			};
			if (opts?.timeout !== undefined && opts.timeout > 0) {
				entry.timer = setTimeout(() => this.settle(id, "timeout"), opts.timeout);
			}
			if (opts?.signal) {
				entry.onAbort = () => this.settle(id, "aborted");
				opts.signal.addEventListener("abort", entry.onAbort, { once: true });
			}
			this.pending.set(id, entry);
			this.listeners.onRequest(request);
		});
	}

	respond(requestId: string, answer: ExtensionDialogRespond): void {
		const entry = this.pending.get(requestId);
		if (!entry || entry.settled) return;
		if ("cancelled" in answer) {
			this.settle(requestId, "answered");
			return;
		}
		if (entry.request.kind === "confirm") {
			this.settle(requestId, "answered", "confirmed" in answer && answer.confirmed === true);
		} else if (entry.request.kind === "form") {
			this.settle(
				requestId,
				"answered",
				"answers" in answer && Array.isArray(answer.answers) ? answer.answers : undefined,
			);
		} else {
			this.settle(
				requestId,
				"answered",
				"value" in answer && typeof answer.value === "string"
					? answer.value
					: CANCEL_VALUE[entry.request.kind],
			);
		}
	}

	dispose(): void {
		for (const id of [...this.pending.keys()]) this.settle(id, "sessionClosed");
	}

	private settle(
		requestId: string,
		reason: ExtensionDialogResolved["reason"],
		value?: string | boolean | string[],
	): void {
		const entry = this.pending.get(requestId);
		if (!entry || entry.settled) return;
		entry.settled = true;
		if (entry.timer !== undefined) clearTimeout(entry.timer);
		if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
		this.pending.delete(requestId);
		entry.resolve(value !== undefined ? value : CANCEL_VALUE[entry.request.kind]);
		this.listeners.onResolved({
			sessionId: entry.request.sessionId,
			requestId,
			reason,
		});
	}
}
