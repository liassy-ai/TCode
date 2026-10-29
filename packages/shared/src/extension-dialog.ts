export type ExtensionDialogKind = "select" | "input" | "editor" | "confirm" | "form";

export interface ExtensionDialogRequest {
	id: string;
	sessionId: string;
	kind: ExtensionDialogKind;

	title: string;

	message?: string;

	options?: string[];

	placeholder?: string;

	prefill?: string;

	questions?: ExtensionDialogQuestion[];

	timeoutMs?: number;

	requestedAt: number;
}

export interface ExtensionDialogQuestion {
	question: string;
	options?: string[];
	allowCustom?: boolean;
	placeholder?: string;

	multiple?: boolean;
}
export type ExtensionDialogRespond =
	| { value: string }
	| { confirmed: boolean }
	| { answers: string[] }
	| { cancelled: true };

export interface ExtensionDialogResolved {
	sessionId: string;
	requestId: string;

	reason: "answered" | "timeout" | "aborted" | "sessionClosed";
}

export interface ExtensionNotifyEvent {
	sessionId: string;

	extensionPath: string;
	message: string;
	level: "info" | "warning" | "error";
}

export interface ExtensionEditorTextEvent {
	sessionId: string;
	text: string;

	source?: string;
}
