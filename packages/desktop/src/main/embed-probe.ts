import type { RemoteBrowserEmbedCheck } from "@tcode/shared";

const PROBE_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PROBE_TIMEOUT_MS = 10_000;

export async function probeEmbeddable(url: string): Promise<RemoteBrowserEmbedCheck> {
	if (!/^https?:\/\//i.test(url)) return { embeddable: false, reason: "仅支持 http(s) 地址直嵌" };
	try {
		const res = await fetch(url, {
			redirect: "follow",
			headers: { "user-agent": PROBE_UA },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		void res.body?.cancel().catch(() => {});
		const xfo = (res.headers.get("x-frame-options") ?? "").trim().toLowerCase();
		if (xfo.includes("deny")) return { embeddable: false, reason: "X-Frame-Options: DENY" };
		if (xfo.includes("sameorigin")) return { embeddable: false, reason: "X-Frame-Options: SAMEORIGIN" };
		if (xfo.includes("allow-from")) return { embeddable: false, reason: `X-Frame-Options: ${xfo}` };
		const csp = res.headers.get("content-security-policy") ?? "";
		const frameAncestors = csp
			.match(/frame-ancestors([^;]*)/i)?.[1]
			?.trim()
			.toLowerCase();
		if (frameAncestors && frameAncestors !== "*") {
			return { embeddable: false, reason: `CSP frame-ancestors ${frameAncestors}` };
		}

		if (!res.ok) return { embeddable: false, reason: `HTTP ${res.status}` };
		return { embeddable: true, reason: null };
	} catch {
		return { embeddable: false, reason: "探测失败（网络/超时），按流式打开" };
	}
}
