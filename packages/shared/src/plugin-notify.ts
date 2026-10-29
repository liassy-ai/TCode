export interface PluginGiftItem {
	id: string;
	title?: string;
	content?: string;
	meta?: string;
}

export interface PluginAnnounceItem {
	id?: string;
	title?: string;
	content: string;
	signature?: string;
}

export type PluginNotify =
	| { id: number; kind: "kicked"; text?: string }
	| { id: number; kind: "login_state"; enabled: boolean }
	| { id: number; kind: "gift"; items: PluginGiftItem[] }
	| { id: number; kind: "maintenance"; active: boolean; note?: string }
	| { id: number; kind: "kv"; action: string; key?: string; data?: unknown }
	| { id: number; kind: "pay"; action: string; orderId?: string; data?: unknown }
	| { id: number; kind: "qr"; image?: string; text?: string; scanned?: boolean; pending?: boolean }
	| { id: number; kind: "status"; text: string; ok?: boolean }
	| {
			id: number;
			kind: "tunnel";
			state: string;
			url?: string;
			text?: string;
			hint?: string;
			billing?: string;
	  }
	| {
			id: number;
			kind: "update_state";
			channel: string;
			locked?: boolean;
			internal_available?: boolean;
			internal_state?: string;
			version_channel?: string;
			login_enabled?: boolean;
			channels?: string[];
			internal_version?: string;
			maintenance?: boolean;
			maintenance_note?: string;
	  }
	| {
			id: number;
			kind: "announce";
			title?: string;
			content: string;
			signature?: string;

			queue?: PluginAnnounceItem[];
	  }
	| {
			id: number;
			kind: "update";
			version: string;
			name?: string;
			url?: string;
			notes?: string;
			force?: boolean;
			pushed?: boolean;
			channel?: string;
			channel_locked?: boolean;
			internal_available?: boolean;
			internal_state?: string;

			version_channel?: string;
			min_version?: string;
			update_mode?: string;
			maintenance?: boolean;
			maintenance_note?: string;
	  };
