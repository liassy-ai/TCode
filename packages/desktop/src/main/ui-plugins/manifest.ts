import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@tcode/backend";
import {
	KNOWN_UI_REGIONS,
	KNOWN_UI_SLOTS,
	UI_PLUGIN_ANCHORS,
	type UiPluginContribution,
	type UiPluginManifest,
} from "@tcode/shared";

const log = createLogger("ui-plugins");

export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAIN_RE = /\.(ts|tsx|js|jsx)$/;
const CONTRIBUTION_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateManifest(dirName: string, m: Partial<UiPluginManifest>): string | null {
	if (!m || typeof m !== "object") return "plugin.json 缺失或损坏";
	if (typeof m.name !== "string" || !NAME_RE.test(m.name) || m.name !== dirName) {
		return `name 非法（须匹配 ${NAME_RE.source} 且与目录名一致）`;
	}
	if (m.tcodeUi !== 1) return "tcodeUi 版本不匹配（当前只接受 1）";
	if (typeof m.main !== "string" || m.main.includes("..") || !MAIN_RE.test(m.main)) {
		return "main 非法（须为目录内相对路径，禁止 .. 穿越，后缀 .ts/.tsx/.js/.jsx）";
	}

	const slotsOk = !!m.slots && typeof m.slots === "object" && Object.keys(m.slots).length > 0;
	if (m.contributions !== undefined && !Array.isArray(m.contributions)) {
		return "contributions 必须是数组";
	}
	if (!slotsOk && (m.contributions?.length ?? 0) === 0 && m.headless !== true) {
		return "slots / contributions / headless 至少其一非空";
	}
	if (slotsOk) {
		for (const [slot, exportName] of Object.entries(m.slots ?? {})) {
			if (!KNOWN_UI_SLOTS.includes(slot)) return `槽位 ${slot} 未知`;
			if (typeof exportName !== "string" || exportName.length === 0) return `槽位 ${slot} 的导出名非法`;
		}
	}

	const seenIds = new Set<string>();
	for (const c of m.contributions ?? []) {
		if (!c || typeof c !== "object") return "contributions 条目非法";
		if (typeof c.region !== "string" || !KNOWN_UI_REGIONS.includes(c.region)) {
			log.warn(`manifest contribution 忽略未知 region:`, JSON.stringify(c));
			continue;
		}
		if (typeof c.id !== "string" || !CONTRIBUTION_ID_RE.test(c.id)) {
			return `contribution ${String(c.id)} 的 id 非法（须匹配 ${CONTRIBUTION_ID_RE.source}）`;
		}
		if (seenIds.has(c.id)) return `contribution id 重复：${c.id}`;
		seenIds.add(c.id);
		if (typeof c.export !== "string" || c.export.length === 0) {
			return `contribution ${c.id} 的 export 非法`;
		}
		if (
			c.anchor !== undefined &&
			!UI_PLUGIN_ANCHORS.includes(c.anchor as (typeof UI_PLUGIN_ANCHORS)[number])
		) {
			return `contribution ${c.id} 的 anchor 非法（须为九宫格枚举）`;
		}
	}
	return null;
}

export function filterContributions(
	contributions: UiPluginContribution[] | undefined,
): UiPluginContribution[] {
	if (!Array.isArray(contributions)) return [];
	const out: UiPluginContribution[] = [];
	for (const c of contributions) {
		if (!c || typeof c.region !== "string" || !KNOWN_UI_REGIONS.includes(c.region)) continue;
		out.push(c.region === "app.overlay" ? c : { ...c, anchor: undefined });
	}
	return out;
}

export async function readManifest(dir: string): Promise<Partial<UiPluginManifest> | null> {
	try {
		const raw = await readFile(join(dir, "plugin.json"), "utf-8");
		return JSON.parse(raw) as Partial<UiPluginManifest>;
	} catch {
		return null;
	}
}
