import { readFileSync } from "node:fs";
import { formatDimensionNote, type InlineExtension, resizeImage } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../../log";

const log = createLogger("shot-hydration");

interface ShotWireMessage {
	role?: string;
	content?: unknown[];
	details?: unknown;
}

function shotPathOf(m: ShotWireMessage | undefined): string | null {
	const shot = (m?.details as { shot?: { path?: unknown } } | undefined)?.shot;
	return typeof shot?.path === "string" && shot.path ? shot.path : null;
}

export function makeShotHydrationExtension(): InlineExtension {
	return {
		name: "shot-hydration",
		factory: (pi) => {
			let cachedPath = "";
			let cachedBlocks: unknown[] | null = null;

			async function hydrate(path: string): Promise<unknown[] | null> {
				if (cachedPath === path && cachedBlocks) return cachedBlocks;
				let bytes: Buffer;
				try {
					bytes = readFileSync(path);
				} catch {
					return null;
				}
				let blocks: unknown[];
				try {
					const resized = await resizeImage(bytes, "image/png");
					if (resized) {
						blocks = [{ type: "image", data: resized.data, mimeType: resized.mimeType }];
						const note = formatDimensionNote(resized);
						if (note) blocks.push({ type: "text", text: note });
					} else {
						blocks = [{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" }];
					}
				} catch {
					blocks = [{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" }];
				}
				cachedPath = path;
				cachedBlocks = blocks;
				return blocks;
			}

			pi.on("context", async (event) => {
				try {
					const messages = event.messages as unknown as ShotWireMessage[];

					let idx = -1;
					for (let i = messages.length - 1; i >= 0; i--) {
						if (shotPathOf(messages[i])) {
							idx = i;
							break;
						}
					}
					if (idx < 0) return undefined;
					const path = shotPathOf(messages[idx]);
					if (!path) return undefined;
					const blocks = await hydrate(path);
					if (!blocks) return undefined;
					const msg = messages[idx];
					if (!msg) return undefined;
					const content = Array.isArray(msg.content) ? msg.content : [];

					if (content.some((b) => (b as { type?: unknown })?.type === "image")) return undefined;
					const next = messages.slice();
					next[idx] = { ...msg, content: [...content, ...blocks] } as ShotWireMessage;
					return { messages: next as unknown as typeof event.messages };
				} catch (err) {
					log.error("shot hydration 失败，原样放行", {
						error: err instanceof Error ? err.message : String(err),
					});
					return undefined;
				}
			});
		},
	};
}
