export function randomUid(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `uid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
