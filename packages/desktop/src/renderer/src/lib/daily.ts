import { getPi } from "../api";

let dailyDir: string | null = null;

export async function initDailyDir(): Promise<string | null> {
	if (dailyDir) return dailyDir;
	try {
		dailyDir = await getPi().getDailyDir();
	} catch (error) {
		console.error("日常空间目录获取失败", error);
	}
	return dailyDir;
}

export function getDailyDirCached(): string | null {
	return dailyDir;
}

export function isDailyCwd(cwd: string | null | undefined): boolean {
	return typeof cwd === "string" && dailyDir !== null && cwd === dailyDir;
}

export function setDailyDirForTest(dir: string | null): void {
	dailyDir = dir;
}
