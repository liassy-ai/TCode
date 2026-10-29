import type { SessionMeta } from "@tcode/shared";

export function buildDiagnosticsText(
	session: Pick<SessionMeta, "sessionId" | "sessionFile" | "name">,
	info: { platform: string; appVersion: string },
): string {
	const sessionFile = session.sessionFile ?? "(内存会话)";
	const dir = sessionFile.includes("/") ? sessionFile.slice(0, sessionFile.lastIndexOf("/")) : "";
	const traceFile = dir ? `${dir}/traces/trace-${session.sessionId}.jsonl` : "(内存会话)";
	return [
		"TCode 诊断信息",
		`sessionId: ${session.sessionId}`,
		`name: ${session.name ?? "(未命名)"}`,
		`sessionFile: ${sessionFile}`,
		`traceFile: ${traceFile}`,
		`appVersion: ${info.appVersion}`,
		`platform: ${info.platform}`,
	].join("\n");
}
