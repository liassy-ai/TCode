import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function getDailyDir(): string {
	return join(homedir(), ".tcode", "daily");
}

export async function ensureDailyDir(): Promise<string> {
	const dir = getDailyDir();
	await mkdir(dir, { recursive: true });
	return dir;
}
