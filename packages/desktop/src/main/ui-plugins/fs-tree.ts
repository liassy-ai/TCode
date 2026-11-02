import { cp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@tcode/backend";

const log = createLogger("ui-plugins");

export async function copyTree(src: string, dst: string): Promise<boolean> {
	try {
		const srcStat = await stat(src);
		if (srcStat.isDirectory()) {
			const [srcEntries, dstExists] = await Promise.all([readdir(src), stat(dst).catch(() => null)]);
			if (dstExists?.isDirectory()) {
				let allSame = true;
				for (const entry of srcEntries) {
					if (!(await sameTree(join(src, entry), join(dst, entry)))) {
						allSame = false;
						break;
					}
				}
				if (allSame) return true;
			}
			await rm(dst, { recursive: true, force: true });
			await cp(src, dst, { recursive: true });
			return true;
		}
		return true;
	} catch (err) {
		log.error("copyTree failed", src, err);
		return false;
	}
}

export async function sameTree(a: string, b: string): Promise<boolean> {
	const [sa, sb] = await Promise.all([stat(a), stat(b).catch(() => null)]);
	if (!sb || sa.isDirectory() !== sb.isDirectory()) return false;
	if (sa.isFile()) {
		const [fa, fb] = await Promise.all([readFile(a), readFile(b)]);
		return fa.equals(fb);
	}
	if (sa.isDirectory()) {
		const [ea, eb] = await Promise.all([readdir(a), readdir(b)]);
		if (ea.length !== eb.length) return false;
		for (const entry of ea) {
			if (!eb.includes(entry)) return false;
			if (!(await sameTree(join(a, entry), join(b, entry)))) return false;
		}
		return true;
	}
	return false;
}

export async function newestMtime(dir: string): Promise<number | null> {
	let newest: number | null = null;
	const walk = async (d: string) => {
		const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const p = join(d, entry.name);
			if (entry.isDirectory()) {
				await walk(p);
			} else {
				const s = await stat(p).catch(() => null);
				if (s && (newest === null || s.mtimeMs > newest)) newest = s.mtimeMs;
			}
		}
	};
	await walk(dir);
	return newest;
}
