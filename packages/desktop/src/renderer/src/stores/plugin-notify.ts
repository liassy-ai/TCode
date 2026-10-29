import type { PluginGiftItem, PluginNotify } from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";
import { useToastsStore } from "./toasts";
import { useUpdateStore } from "./update";

export interface PluginQrView {
	image?: string;
	text?: string;
	scanned?: boolean;
	pending?: boolean;
}

export interface PluginTunnelView {
	state: string;
	url?: string;
	text?: string;
	hint?: string;
	billing?: string;
}

export interface PluginAnnounceView {
	id?: string;
	title?: string;
	content: string;
	signature?: string;
}

interface PluginNotifyStore {
	loginEnabled: boolean;
	loginDisabled: boolean;

	qr: PluginQrView | null;
	announce: PluginAnnounceView | null;

	announceQueue: PluginAnnounceView[];

	gift: PluginGiftItem[] | null;

	updateChannel: string;

	updateChannelLocked: boolean;

	internalAvailable: boolean;

	internalState: string;

	versionChannel: string;

	channels: string[];

	internalVersion: string;

	tunnel: PluginTunnelView | null;
	dismissGift: () => void;
	apply: (n: PluginNotify) => void;
	clearQr: () => void;

	clearAccountState: () => void;
	dismissAnnounce: () => void;
	start: () => () => void;
}

export const usePluginNotifyStore = create<PluginNotifyStore>((set, get) => ({
	loginEnabled: false,
	loginDisabled: false,
	updateChannel: "stable",
	updateChannelLocked: false,
	internalAvailable: false,
	internalState: "",
	versionChannel: "",
	channels: [],
	internalVersion: "",
	tunnel: null,
	qr: null,
	announce: null,
	announceQueue: [],
	gift: null,
	apply: (n) => {
		if (n.kind === "login_state")
			set(
				n.enabled === false
					? { loginEnabled: false, loginDisabled: true, qr: null }
					: { loginEnabled: true, loginDisabled: false },
			);
		else if (n.kind === "gift") set({ gift: n.items ?? [] });
		else if (n.kind === "update_state") {
			set({
				updateChannel: n.channel || "stable",
				updateChannelLocked: n.locked === true,
				...(n.internal_available === undefined ? {} : { internalAvailable: n.internal_available === true }),
				...(n.internal_state === undefined ? {} : { internalState: n.internal_state ?? "" }),
				...(n.version_channel === undefined ? {} : { versionChannel: n.version_channel ?? "" }),
				...(n.login_enabled === undefined
					? {}
					: { loginEnabled: n.login_enabled === true, loginDisabled: n.login_enabled !== true }),
				...(Array.isArray(n.channels) ? { channels: n.channels as string[] } : {}),
				...(n.internal_version === undefined ? {} : { internalVersion: n.internal_version ?? "" }),
			});

			if (n.maintenance !== undefined)
				useUpdateStore.getState().setMaintenance(n.maintenance === true, n.maintenance_note ?? "");
		} else if (n.kind === "status")
			useToastsStore.getState().pushExtension(n.ok === false ? "error" : "info", n.text || "操作完成");
		else if (n.kind === "qr") {
			if (get().loginDisabled) return;
			set({
				loginEnabled: true,
				qr: {
					image: n.image,
					text: n.text,
					scanned: n.scanned === true,
					pending: n.pending === true,
				},
			});
		} else if (n.kind === "announce") {
			const list = (
				n.queue && n.queue.length > 0
					? n.queue
					: [{ id: undefined, title: n.title, content: n.content, signature: n.signature }]
			).map((x) => ({ id: x.id, title: x.title, content: x.content, signature: x.signature }));
			set({ announce: list[0] ?? null, announceQueue: list.slice(1) });
		} else if (n.kind === "kicked") {
			set({ announce: { title: "已下线", content: n.text || "已被管理员强制下线，请重新登录。" } });

			usePluginNotifyStore.getState().clearAccountState();
			useUpdateStore.getState().reset();
		} else if (n.kind === "tunnel")
			set({ tunnel: { state: n.state, url: n.url, text: n.text, hint: n.hint, billing: n.billing } });
		else if (n.kind === "maintenance")
			useUpdateStore.getState().setMaintenance(n.active === true, n.note ?? "");
		else if (n.kind === "update") {
			useUpdateStore.getState().setAvailable(n.version, n.url ?? "", {
				minVersion: n.min_version,
				force: n.update_mode === "force" || n.force === true,
				notes: n.notes,
			});
			if (n.channel) set({ updateChannel: n.channel, updateChannelLocked: n.channel_locked === true });
			set({
				internalAvailable: n.internal_available === true,
				internalState: n.internal_state ?? "",
				versionChannel: n.version_channel ?? "",
			});
		}
	},
	clearQr: () => set({ qr: null }),
	clearAccountState: () =>
		set({
			internalAvailable: false,
			internalState: "",
			versionChannel: "",
			channels: [],
			internalVersion: "",
			updateChannel: "stable",
			updateChannelLocked: false,
			gift: null,
		}),
	dismissGift: () => set({ gift: null }),
	dismissAnnounce: () => {
		const current = usePluginNotifyStore.getState().announce;
		if (current?.id) void getPi().pluginCommand({ cmd: `announce-ack:${current.id}` });
		set((s) => {
			if (s.announceQueue.length > 0)
				return { announce: s.announceQueue[0], announceQueue: s.announceQueue.slice(1) };
			return { announce: null };
		});
	},
	start: () => {
		const apply = (n: PluginNotify) => usePluginNotifyStore.getState().apply(n);
		let pending: PluginNotify[] | null = [];
		const flush = () => {
			const queued = pending;
			pending = null;
			for (const n of queued ?? []) apply(n);
		};
		const onNotify = (n: PluginNotify) => {
			if (pending) pending.push(n);
			else apply(n);
		};
		const off = getPi().onPluginNotify(onNotify);
		void getPi()
			.pluginNotifyGet()
			.then((list) => {
				for (const n of list ?? []) apply(n);
			})
			.catch(() => undefined)
			.finally(flush);
		return off;
	},
}));
