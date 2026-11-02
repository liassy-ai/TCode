import type { SessionMeta } from "@tcode/shared";

export function isPrimaryNavigationSession(session: SessionMeta): boolean {
	return session.readOnly !== true;
}
