import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ArchiveEntry, ArchiveMeta, ArchiveResult } from "@tcode/shared";
import { checkpointProjectDir, checkpointRepoDir } from "./checkpoints";

export const ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

function archiveRoot(): string {
	return join(agentDir(), "sessions-archive");
}

function projectOf(sessionFile: string): string {
	return basename(dirname(sessionFile));
}

async function writeMeta(dir: string, meta: ArchiveMeta): Promise<void> {
	await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

async function readMeta(dir: string): Promise<ArchiveMeta | null> {
	try {
		return JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as ArchiveMeta;
	} catch {
		return null;
	}
}

async function movePath(from: string, to: string): Promise<void> {
	await mkdir(dirname(to), { recursive: true });
	try {
		await rename(from, to);
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
	}
	await cp(from, to, { recursive: true });
	await rm(from, { recursive: true, force: true });
}

async function dirSize(dir: string): Promise<number> {
	let total = 0;
	for (const item of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, item.name);
		total += item.isDirectory() ? await dirSize(full) : (await readFile(full)).byteLength;
	}
	return total;
}

async function pruneEmptyDirs(dir: string): Promise<void> {
	if (!existsSync(dir)) return;
	if ((await readdir(dir)).length > 0) return;
	await rm(dir, { recursive: true, force: true });
}

export async function listArchives(): Promise<ArchiveEntry[]> {
	const root = archiveRoot();
	if (!existsSync(root)) return [];
	const entries: ArchiveEntry[] = [];
	for (const project of await readdir(root, { withFileTypes: true })) {
		if (!project.isDirectory()) continue;
		for (const item of await readdir(join(root, project.name), { withFileTypes: true })) {
			if (!item.isDirectory()) continue;
			const dir = join(root, project.name, item.name);
			const meta = await readMeta(dir);
			if (meta) entries.push({ ...meta, dir });
		}
	}
	return entries.sort((a, b) => b.archivedAt - a.archivedAt);
}

export async function archiveSession(input: {
	sessionId: string;
	sessionFile: string;
	cwd: string;
	name?: string;
}): Promise<ArchiveResult> {
	const { sessionId, sessionFile, cwd, name } = input;
	const project = projectOf(sessionFile);
	const dir = join(archiveRoot(), project, sessionId + "-" + Date.now());
	const meta: ArchiveMeta = {
		sessionId,
		sessionFile,
		cwd,
		project,
		name,
		archivedAt: Date.now(),
		sizeBytes: 0,
	};

	await mkdir(dir, { recursive: true });
	await writeMeta(dir, meta);

	if (existsSync(sessionFile)) await movePath(sessionFile, join(dir, "session.jsonl"));

	const traceDir = join(dirname(sessionFile), "traces");
	if (existsSync(traceDir)) {
		for (const f of await readdir(traceDir)) {
			if (f.startsWith("trace-" + sessionId)) await movePath(join(traceDir, f), join(dir, "traces", f));
		}
	}

	const repo = checkpointRepoDir(sessionId, cwd);
	if (existsSync(repo)) await movePath(repo, join(dir, "checkpoints.git"));
	await pruneEmptyDirs(checkpointProjectDir(cwd));

	meta.sizeBytes = await dirSize(dir);
	await writeMeta(dir, meta);
	return { ok: true, dir };
}

export async function restoreArchive(dir: string): Promise<ArchiveResult> {
	const meta = await readMeta(dir);
	if (!meta) return { ok: false, reason: "no-target" };
	if (existsSync(meta.sessionFile)) return { ok: false, reason: "conflict" };
	const session = join(dir, "session.jsonl");
	if (existsSync(session)) await movePath(session, meta.sessionFile);
	const traces = join(dir, "traces");
	if (existsSync(traces)) {
		for (const f of await readdir(traces)) {
			await movePath(join(traces, f), join(dirname(meta.sessionFile), "traces", f));
		}
	}
	const repo = join(dir, "checkpoints.git");
	if (existsSync(repo)) await movePath(repo, checkpointRepoDir(meta.sessionId, meta.cwd));
	await rm(dir, { recursive: true, force: true });
	await pruneEmptyDirs(dirname(dir));
	return { ok: true };
}

export async function deleteArchive(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
	await pruneEmptyDirs(dirname(dir));
}

export async function cleanupExpiredArchives(ttlMs = ARCHIVE_TTL_MS): Promise<number> {
	const cutoff = Date.now() - ttlMs;
	let removed = 0;
	for (const entry of await listArchives()) {
		if (entry.archivedAt < cutoff) {
			await deleteArchive(entry.dir);
			removed += 1;
		}
	}
	return removed;
}
