import { createLogger } from "@tcode/backend";
import { session } from "electron";

const log = createLogger("session-security");

const BASE_DIRECTIVES = [
	"default-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: pi-bg: blob:",
	"font-src 'self' data:",
	"media-src 'self' data:",
	"connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
	"frame-src https: http:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
];

const APP_CSP = ["script-src 'self' 'wasm-unsafe-eval' blob:", ...BASE_DIRECTIVES].join("; ");

const DEV_CSP = ["script-src 'self' 'wasm-unsafe-eval' blob: 'unsafe-inline'", ...BASE_DIRECTIVES].join("; ");

export function installSessionSecurityCsp(devOrigin: string | null): void {
	const isAppUrl = (u: string): boolean =>
		u.startsWith("file://") || (devOrigin !== null && u.startsWith(devOrigin));
	const csp = devOrigin !== null ? DEV_CSP : APP_CSP;

	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		const headers = details.responseHeaders ?? {};
		if (!isAppUrl(details.url)) {
			callback({ responseHeaders: headers });
			return;
		}
		const has = Object.keys(headers).some((k) => k.toLowerCase() === "content-security-policy");
		if (!has) headers["Content-Security-Policy"] = [csp];
		callback({ responseHeaders: headers });
	});
	log.info("CSP header injection installed", {
		devOrigin: devOrigin ?? "(file://)",
		mode: devOrigin ? "dev" : "prod",
	});
}
