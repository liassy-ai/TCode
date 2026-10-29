import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { basename, join } from "node:path";
import { createLogger } from "@tcode/backend";
import { app } from "electron";

const log = createLogger("updater");

export interface UpdateProgress {
	received: number;
	total: number;
	percent: number;
}

export class UpdateManager {
	private filePath = "";

	async download(url: string, onProgress: (p: UpdateProgress) => void): Promise<void> {
		if (!url) throw new Error("缺少下载地址");
		let name = "update.exe";
		try {
			name = basename(new URL(url).pathname) || name;
		} catch {}
		const dir = join(app.getPath("userData"), "updates");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, name);
		await this.fetchToFile(url, file, onProgress, 5);
		this.filePath = file;
		log.info("更新已下载", { file });
	}

	private fetchToFile(
		url: string,
		file: string,
		onProgress: (p: UpdateProgress) => void,
		redirectsLeft: number,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			let u: URL;
			try {
				u = new URL(url);
			} catch {
				reject(new Error("无效的下载地址"));
				return;
			}
			const lib = u.protocol === "http:" ? httpGet : httpsGet;
			const req = lib(url, (res) => {
				const status = res.statusCode ?? 0;
				if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
					res.resume();
					this.fetchToFile(
						new URL(res.headers.location, url).toString(),
						file,
						onProgress,
						redirectsLeft - 1,
					).then(resolve, reject);
					return;
				}
				if (status !== 200) {
					res.resume();
					reject(new Error(`HTTP ${status}`));
					return;
				}
				const total = Number(res.headers["content-length"] ?? 0) || 0;
				let received = 0;
				const out = createWriteStream(file);
				res.on("data", (chunk: Buffer) => {
					received += chunk.length;
					onProgress({
						received,
						total,
						percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
					});
				});
				res.on("error", reject);
				res.pipe(out);
				out.on("error", reject);
				out.on("finish", () => {
					out.close(() => resolve());
				});
			});
			req.on("error", reject);
		});
	}

	install(): { ok: boolean; error?: string } {
		if (!this.filePath || !existsSync(this.filePath)) return { ok: false, error: "尚未下载更新" };
		try {
			spawn(this.filePath, [], { detached: true, stdio: "ignore" }).unref();
			return { ok: true };
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	}
}
