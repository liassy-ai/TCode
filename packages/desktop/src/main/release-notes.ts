import { createLogger } from "@tcode/backend";

const log = createLogger("release-notes");
const REPO = "liassy-ai/TCode";
const TTL_MS = 10 * 60_000;

export interface ReleaseNotes {
	version: string;
	notes: string;
	url: string;
}

let cache: { at: number; items: ReleaseNotes[] } | null = null;

function normalize(version: string): string {
	return (version || "").trim().replace(/^v/i, "").toLowerCase();
}

async function fetchReleases(): Promise<ReleaseNotes[]> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.items;
	const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "tcode-desktop" },
	});
	if (!res.ok) throw new Error(`GitHub ${res.status}`);
	const list = (await res.json()) as Array<{ tag_name?: string; body?: string; html_url?: string }>;
	const items = list
		.map((r) => ({ version: normalize(r.tag_name ?? ""), notes: r.body ?? "", url: r.html_url ?? "" }))
		.filter((i) => i.version !== "");
	cache = { at: Date.now(), items };
	return items;
}

export async function releaseNotesFor(version: string): Promise<ReleaseNotes | null> {
	const want = normalize(version);
	if (!want) return null;
	try {
		const items = await fetchReleases();
		const exact = items.find((i) => i.version === want);
		if (exact) return exact;
		const loose = items.find((i) => i.version.startsWith(want) || want.startsWith(i.version));
		if (loose) return loose;
		log.info("没有匹配版本的发布说明", { version: want, known: items.map((i) => i.version) });
		return null;
	} catch (error) {
		log.warn("读取发布说明失败", { error: (error as Error).message });
		return null;
	}
}
