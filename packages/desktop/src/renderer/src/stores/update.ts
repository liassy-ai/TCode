import { create } from "zustand";
import { getPi } from "../api";
import { useToastsStore } from "./toasts";

type Status = "idle" | "available" | "downloading" | "downloaded" | "error";

interface UpdateStore {
	current: string;
	version: string;
	url: string;
	minVersion: string;
	required: boolean;
	maintenance: boolean;
	maintenanceNote: string;

	notes: string;
	setMaintenance: (active: boolean, note: string) => void;
	status: Status;
	percent: number;
	error: string;
	init: () => Promise<void>;
	setAvailable: (
		version: string,
		url: string,
		extra?: { minVersion?: string; force?: boolean; notes?: string },
	) => void;
	download: () => Promise<void>;
	install: () => Promise<void>;
	reset: () => void;
}

function verParts(v: string): number[] {
	return (v || "")
		.trim()
		.replace(/^v/i, "")
		.split(/[.\-+_]/)
		.map((p) => {
			const n = Number.parseInt(p, 10);
			return Number.isFinite(n) ? n : 0;
		});
}

function isNewer(remote: string, current: string): boolean {
	const a = verParts(remote);
	const b = verParts(current);
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

function platformOf(url: string): "win32" | "darwin" | "linux" | "" {
	const u = url.toLowerCase();
	if (/\.(exe|msi)(?:$|[?#])/.test(u) || /(?:^|[/_\-. ])(win|windows|win32|win64)(?:[/_\-. ]|$)/.test(u))
		return "win32";
	if (/\.dmg(?:$|[?#])/.test(u) || /(?:^|[/_\-. ])(mac|macos|darwin|osx)(?:[/_\-. ]|$)/.test(u))
		return "darwin";
	if (/\.(appimage|deb|rpm)(?:$|[?#])/.test(u) || /(?:^|[/_\-. ])(linux)(?:[/_\-. ]|$)/.test(u))
		return "linux";
	return "";
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
	current: "",
	version: "",
	url: "",
	minVersion: "",
	required: false,
	maintenance: false,
	maintenanceNote: "",
	notes: "",
	status: "idle",
	percent: 0,
	error: "",
	init: async () => {
		try {
			const info = await getPi().getAppInfo();
			set({ current: info?.version ?? "" });
		} catch {}
	},
	setMaintenance: (active, note) => {
		set({ maintenance: active, maintenanceNote: note });
	},
	setAvailable: (version, url, extra) => {
		const s = get();
		if (s.status === "downloading" || s.status === "downloaded") return;

		if (!url || !version) {
			if (s.status !== "idle" || s.version || s.url)
				set({ version: "", url: "", status: "idle", percent: 0, error: "", notes: "", required: false });
			return;
		}
		const minVersion = (extra?.minVersion ?? "").trim();
		const force = extra?.force === true;
		const decide = (cur: string) => {
			if (!cur) return;

			const required = force && (minVersion === "" ? true : isNewer(minVersion, cur));
			const newer = isNewer(version, cur);
			if (!newer && !required) {
				if (s.required) set({ required: false });
				return;
			}
			const p = platformOf(url);
			const plat = getPi().platform;
			if (p && plat && p !== plat) return;
			const notesText = (extra?.notes ?? "").trim();
			set({ version, url, status: "available", error: "", minVersion, required, notes: notesText });

			if (notesText)
				useToastsStore
					.getState()
					.pushExtension("info", `新版本 ${version}：${notesText.replace(/\s*\n\s*/g, " ")}`);
		};
		const cur = s.current;
		if (cur) decide(cur);
		else
			void getPi()
				.getAppInfo()
				.then((info) => {
					const v = info?.version ?? "";
					set({ current: v });
					decide(v);
				})
				.catch(() => undefined);
	},
	download: async () => {
		const { url, status } = get();
		if (!url || status === "downloading") return;
		set({ status: "downloading", percent: 0, error: "" });
		try {
			const r = await getPi().updateDownload({ url });
			if (r.ok) set({ status: "downloaded", percent: 100 });
			else set({ status: "error", error: r.error ?? "下载失败" });
		} catch (e) {
			set({ status: "error", error: String(e) });
		}
	},
	install: async () => {
		try {
			const r = await getPi().updateInstall();
			if (!r.ok) set({ status: "error", error: r.error ?? "安装失败" });
		} catch (e) {
			set({ status: "error", error: String(e) });
		}
	},
	reset: () => set({ version: "", url: "", status: "idle", percent: 0, error: "" }),
}));
