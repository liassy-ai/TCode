import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_BYTES = 10 * 1024 * 1024;

const MAX_IMAGES = 9;

const MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

const showImageParams = Type.Object({
	paths: Type.Array(
		Type.String({
			description:
				"Path to an image file: absolute, relative to the working directory, or starting with ~ (home directory)",
		}),
		{
			minItems: 1,
			maxItems: MAX_IMAGES,
			description: `Image file paths to display (1-${MAX_IMAGES})`,
		},
	),
});

const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g;

export function resolveShowImagePath(rawPath: string, cwd: string, home: string = homedir()): string {
	let p = rawPath.replace(UNICODE_SPACES, " ");
	if (p === "~") p = home;
	else if (p.startsWith("~/")) p = join(home, p.slice(2));
	return isAbsolute(p) ? p : resolve(cwd, p);
}

export interface ShowImageDetails {
	paths: string[];
	images: { data: string; mimeType: string }[];
}

export function makeShowImageTool(): ToolDefinition<typeof showImageParams> {
	return {
		name: "show_image",
		label: "Show Image",
		description:
			"Display image files to the user in the chat UI. Use it ONLY when the user explicitly asks to see images, or when showing visual content is clearly necessary (e.g. screenshots or plots you just produced); do NOT call it for every image you read. When showing several related images, pass them ALL in one call's paths array instead of calling repeatedly. The images are shown to the user but NOT added to your context — to see the content yourself, use the read tool.",
		promptSnippet: "show_image({paths})",
		parameters: showImageParams,
		execute: async (
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<AgentToolResult<ShowImageDetails>> => {
			const images: ShowImageDetails["images"] = [];
			for (const rawPath of params.paths) {
				const path = resolveShowImagePath(rawPath, ctx.cwd);
				const mimeType = MIME_BY_EXT[extname(path).toLowerCase()];
				if (!mimeType) {
					throw new Error(
						`show_image: unsupported image type for "${rawPath}" (supported: png, jpg, jpeg, gif, webp, bmp)`,
					);
				}
				const info = await stat(path).catch(() => {
					throw new Error(`show_image: file not found: ${path}`);
				});
				if (!info.isFile()) throw new Error(`show_image: not a file: ${path}`);
				if (info.size > MAX_BYTES) {
					throw new Error(
						`show_image: image too large (${Math.ceil(info.size / 1024 / 1024)}MB > ${MAX_BYTES / 1024 / 1024}MB limit): ${rawPath}`,
					);
				}
				images.push({ data: (await readFile(path)).toString("base64"), mimeType });
			}
			const count = images.length;
			return {
				content: [
					{
						type: "text",
						text:
							count === 1
								? `Image displayed to the user in the chat: ${params.paths[0]}`
								: `${count} images displayed to the user in the chat: ${params.paths.join(", ")}`,
					},
				],
				details: { paths: [...params.paths], images },
			};
		},
	};
}
