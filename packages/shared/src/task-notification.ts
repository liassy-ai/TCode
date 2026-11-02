export type TaskNotificationKind = "done" | "attention" | "error";

export interface TaskNotification {
	kind: TaskNotificationKind;

	sessionId: string;

	sessionName: string;

	detail?: string;
}

export interface NotificationOpenPayload {
	sessionId: string;
}
