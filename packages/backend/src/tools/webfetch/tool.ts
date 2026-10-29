import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { htmlToText } from "./html-to-text";
import { assertPublicUrl, type Cidr, FAKE_IP_CIDR, parseCidr } from "./ip-guard";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const DEFAULT_MAX_CHARS = 30_000;

const webFetchParams = Type.Object({
	url: Type.String({ description: "The http:// or https:// URL to fetch" }),
	maxChars: Type.Optional(
		Type.Integer({
			minimum: 1000,
			maximum: 200_000,
			default: DEFAULT_MAX_CHARS,
			description: "Maximum characters to return (default 30000)",
		}),
	),
});

export interface WebFetchDetails {
	url: string;
	finalUrl: string;
	status: number;
	contentType: string;

	fetchedBytes: number;

	bytes: number;
	truncated: boolean;
}

export interface WebFetchOptions {
	allowRanges?: string[];
}

interface FetchResult {
	text: string;
	finalUrl: string;
	status: number;
	contentType: string;

	bytes: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function fetchPublic(
	startUrl: URL,
	signal: AbortSignal | undefined,
	allowRanges: Cidr[],
): Promise<FetchResult> {
	const combined = signal
		? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
		: AbortSignal.timeout(TIMEOUT_MS);
	let url = startUrl;
	let response: Response;
	for (let hop = 0; ; hop++) {
		response = await fetch(url, { redirect: "manual", signal: combined });
		const status = response.status;
		if (REDIRECT_STATUSES.has(status)) {
			const location = response.headers.get("location");
			if (!location) {
				throw new Error(`webfetch: redirect without Location from ${url.href} (status ${status})`);
			}
			if (hop >= MAX_REDIRECTS) {
				throw new Error(`webfetch: too many redirects (max ${MAX_REDIRECTS})`);
			}
			await response.body?.cancel().catch(() => {});
			url = await assertPublicUrl(new URL(location, url).href, allowRanges);
			continue;
		}
		break;
	}
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`webfetch: HTTP ${response.status} ${response.statusText} for ${url.href}`);
	}
	const contentType = response.headers.get("content-type") ?? "";
	const charsetMatch = /charset=([\w-]+)/i.exec(contentType);
	let charset: string | undefined;
	if (charsetMatch) {
		try {
			new TextDecoder(charsetMatch[1]);
			charset = charsetMatch[1];
		} catch {}
	}
	const decoder = new TextDecoder(charset);
	const reader = response.body?.getReader();
	const bytes: Uint8Array[] = [];
	let total = 0;
	if (reader) {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (total + value.length > MAX_BYTES) {
				bytes.push(value.subarray(0, MAX_BYTES - total));
				total = MAX_BYTES;
				await reader.cancel().catch(() => {});
				break;
			}
			bytes.push(value);
			total += value.length;
		}
	}
	return {
		text: decoder.decode(Buffer.concat(bytes)),
		finalUrl: url.href,
		status: response.status,
		contentType,
		bytes: total,
	};
}

const TEXTUAL_CONTENT_TYPE =
	/^text\/|application\/(json|[\w.+-]*\+json|xml|[\w.+-]*\+xml|xhtml\+xml|javascript|x-javascript|ecmascript|yaml|x-yaml|x-www-form-urlencoded)/i;

function rewriteUrl(url: string): string {
	const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+?)(?:[?#].*)?$/.exec(url);
	if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}`;
	return url;
}

export function makeWebFetchTool(options: WebFetchOptions = {}): ToolDefinition<typeof webFetchParams> {
	const allowRanges = [FAKE_IP_CIDR, ...(options.allowRanges ?? []).map(parseCidr)];
	return {
		name: "webfetch",
		label: "Web Fetch",
		description:
			"Fetch a public web page (http/https) and return its readable text as markdown, with navigation and footer boilerplate stripped. Use it for documentation, articles and other public pages; GitHub blob pages are fetched as raw source. Private or internal addresses are refused, content is truncated to maxChars, and binary content (PDF, images, archives) is not extracted.",
		promptSnippet: "webfetch({url})",
		parameters: webFetchParams,
		execute: async (_toolCallId, params, signal): Promise<AgentToolResult<WebFetchDetails>> => {
			const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
			const startUrl = await assertPublicUrl(rewriteUrl(params.url), allowRanges);
			let fetched: FetchResult;
			try {
				fetched = await fetchPublic(startUrl, signal, allowRanges);
			} catch (err) {
				if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
					throw new Error(
						signal?.aborted ? "webfetch aborted by user" : `webfetch timed out after ${TIMEOUT_MS / 1000}s`,
					);
				}
				throw err;
			}
			if (fetched.contentType && !TEXTUAL_CONTENT_TYPE.test(fetched.contentType)) {
				return {
					content: [
						{
							type: "text",
							text: `(binary content: ${fetched.contentType}, ${fetched.bytes} bytes fetched — not extracted; if you need this file, download it with bash and inspect it locally)`,
						},
					],
					details: {
						url: params.url,
						finalUrl: fetched.finalUrl,
						status: fetched.status,
						contentType: fetched.contentType,
						fetchedBytes: fetched.bytes,
						bytes: 0,
						truncated: false,
					},
				};
			}
			const isHtml = /text\/html|application\/xhtml\+xml/i.test(fetched.contentType);
			let text = isHtml ? htmlToText(fetched.text) : fetched.text;
			let truncated = false;
			if (text.length > maxChars) {
				text = `${text.slice(0, maxChars)}\n\n[truncated: ${maxChars} of ${text.length} characters]`;
				truncated = true;
			}
			return {
				content: [{ type: "text", text: text || "(empty page)" }],
				details: {
					url: params.url,
					finalUrl: fetched.finalUrl,
					status: fetched.status,
					contentType: fetched.contentType,
					fetchedBytes: fetched.bytes,
					bytes: Buffer.byteLength(text, "utf8"),
					truncated,
				},
			};
		},
	};
}
