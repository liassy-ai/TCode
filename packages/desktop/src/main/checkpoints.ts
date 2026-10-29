import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GitWorkspaceFile } from "@tcode/shared";
import { patchStat } from "@tcode/shared";
import { app } from "electron";
import { runComponentGit } from "./component-bridge";

export interface Checkpoint {
	sha: string;
	message: string;
	time: string;
	turn?: number;
}

const EXCLUDE = `.git/
node_modules/
dist/
out/
build/
bin/
obj/
target/
Debug/
Release/
.next/
.nuxt/
.svelte-kit/
.output/
.vercel/
.turbo/
.parcel-cache/
.cache/
coverage/
.nyc_output/
.gradle/
__pycache__/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.tox/
.venv/
venv/
DerivedData/
tmp/
logs/
.DS_Store
Thumbs.db
*.log
.env
.env.local
nul
con
aux
prn
com[1-9]
lpt[1-9]
*.exe
*.dll
*.pdb
*.obj
*.o
*.a
*.lib
*.so
*.dylib
*.class
*.jar
*.war
*.pyc
*.pyo
*.pyd
*.node
*.map
*.ilk
*.exp
*.rlib
*.rmeta
*.whl
*.nupkg
*.ibd
*.frm
*.myd
*.myi
*.sqlite
*.sqlite3
*.db-wal
*.db-shm
*.ldb
ibdata*
ib_logfile*
undo0*
_tmp_edge/
_tmp/
`;

const MAX_FILE_BYTES = (() => {
	const mb = Number(process.env.TCODE_CHECKPOINT_MAX_FILE_MB ?? "8");
	return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : 0;
})();

const MAX_TURNS = (() => {
	const n = Number(process.env.TCODE_CHECKPOINT_MAX_TURNS ?? "20");
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
})();

const TRIM_SLACK = 10;

const ARTIFACT_EXT = new Set([
	".exe",
	".dll",
	".pdb",
	".obj",
	".o",
	".a",
	".lib",
	".so",
	".dylib",
	".class",
	".jar",
	".war",
	".pyc",
	".pyo",
	".pyd",
	".node",
	".map",
	".ilk",
	".exp",
	".rlib",
	".rmeta",
	".whl",
	".nupkg",
	".ibd",
	".frm",
	".myd",
	".myi",
	".sqlite",
	".sqlite3",
]);

const SKIP_FILE = "tcode-skip";
const ADD_LIST_FILE = "tcode-add";

function slug(cwd: string): string {
	const mangled = cwd.replace(/[^a-zA-Z0-9]/g, "-").slice(-48);
	const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 8);
	return `${mangled}-${hash}`;
}

export function checkpointProjectDir(cwd: string): string {
	return join(app.getPath("userData"), "checkpoints", slug(cwd));
}

export function checkpointRepoDir(sessionId: string, cwd: string): string {
	return gitDir(sessionId, cwd);
}

function gitDir(sessionId: string, cwd: string): string {
	return join(checkpointProjectDir(cwd), `${sessionId}.git`);
}

function execGit(
	args: string[],
	cwd: string,
	timeout = 30000,
	extraEnv?: Record<string, string>,
): Promise<string> {
	return runComponentGit(
		["--no-pager", "-c", "core.hooksPath=", "-c", "core.quotePath=false", ...args],
		cwd,
		{
			timeoutMs: timeout,
			env: extraEnv,
		},
	).then(({ stdout, stderr, code }) => {
		if (code !== 0 && code !== 1) {
			throw new Error((stderr || "").trim() || `git 执行失败（退出码 ${code}）`);
		}
		return stdout;
	});
}

function runShadow(
	gitDirPath: string,
	workTree: string,
	args: string[],
	timeout = 30000,
	extraEnv?: Record<string, string>,
): Promise<string> {
	return runComponentGit(
		[
			"-c",
			"user.name=TCode",
			"-c",
			"user.email=tcode@local",
			`--git-dir=${gitDirPath}`,
			`--work-tree=${workTree}`,
			...args,
		],
		workTree,
		{ timeoutMs: timeout, env: extraEnv },
	).then(({ stdout, stderr, code }) => {
		if (code !== 0 && code !== 1) {
			throw new Error((stderr || "").trim() || `git 执行失败（退出码 ${code}）`);
		}
		return stdout;
	});
}

async function ensureRepo(dir: string, workTree: string): Promise<void> {
	if (!existsSync(join(dir, "HEAD"))) {
		mkdirSync(dir, { recursive: true });
		await execGit(["init", "--bare", dir], workTree, 20000);
		await execGit([`--git-dir=${dir}`, "config", "core.bare", "false"], workTree, 10000);
	}
	const infoDir = join(dir, "info");
	mkdirSync(infoDir, { recursive: true });
	writeFileSync(join(infoDir, "exclude"), EXCLUDE, "utf8");
}

interface StatusEntry {
	code: string;
	paths: string[];
}

function statusEntries(out: string): StatusEntry[] {
	const parts = out.split("\0");
	const entries: StatusEntry[] = [];
	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		if (!entry || entry.length < 4) continue;
		const code = entry.slice(0, 2);
		const rel = entry.slice(3);
		if (!rel) continue;
		const paths = [rel];
		if (code.includes("R") || code.includes("C")) {
			const original = parts[++i];
			if (original) paths.push(original);
		}
		entries.push({ code, paths });
	}
	return entries;
}

function isArtifactPath(rel: string): boolean {
	const name = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
	const dot = name.lastIndexOf(".");
	if (dot > 0 && ARTIFACT_EXT.has(name.slice(dot))) return true;
	return name === "ibdata1" || name.startsWith("ib_logfile") || /^undo0\d+$/.test(name);
}

function snapshotFileStat(cwd: string, rel: string): { size: number; changedAt: number } | null {
	try {
		const st = statSync(join(cwd, rel));
		return st.isFile()
			? { size: st.size, changedAt: Math.max(st.mtimeMs, st.ctimeMs) }
			: { size: 0, changedAt: 0 };
	} catch {
		return null;
	}
}

function excludeLine(rel: string): string {
	const escaped = rel
		.replace(/\\/g, "/")
		.replace(/([*?[\]])/g, "\\$1")
		.replace(/ /g, "\\ ");
	return `/${escaped}`;
}

function readSkipSet(dir: string): Set<string> {
	try {
		return new Set(
			readFileSync(join(dir, "info", SKIP_FILE), "utf8")
				.split("\n")
				.map((line) => line.replace(/\r$/, ""))
				.filter(Boolean),
		);
	} catch {
		return new Set();
	}
}

function writeExclude(dir: string, skip: Set<string>): void {
	writeFileSync(join(dir, "info", SKIP_FILE), [...skip].join("\n"), "utf8");
	const dynamic = [...skip].map(excludeLine).join("\n");
	writeFileSync(join(dir, "info", "exclude"), EXCLUDE + (dynamic ? `${dynamic}\n` : ""), "utf8");
}

const deletedAtTurnStart = new Map<string, Set<string>>();

export async function markTurnStart(sessionId: string, cwd: string): Promise<void> {
	deletedAtTurnStart.delete(sessionId);
	const dir = gitDir(sessionId, cwd);
	if (!existsSync(dir)) return;
	try {
		const out = await runShadow(dir, cwd, ["ls-files", "--deleted", "-z"], 20000);
		deletedAtTurnStart.set(sessionId, new Set(out.split("\0").filter(Boolean)));
	} catch {}
}

interface LoggedCommit {
	sha: string;
	tree: string;
	authorDate: string;
	committerDate: string;
	message: string;
}

async function reclaimHistory(dir: string, cwd: string, prune = "now"): Promise<void> {
	await runShadow(dir, cwd, ["reflog", "expire", "--expire=now", "--all"], 20000).catch(() => {});
	await runShadow(dir, cwd, ["gc", `--prune=${prune}`, "--quiet"], 120000).catch(() => {});
}

async function maybeTrimHistory(dir: string, cwd: string): Promise<void> {
	if (MAX_TURNS <= 0) return;
	const out = await runShadow(dir, cwd, ["log", "--reverse", "--format=%H%x00%T%x00%aI%x00%cI%x00%s"], 30000);
	const commits: LoggedCommit[] = out
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [sha = "", tree = "", authorDate = "", committerDate = "", message = ""] = line.split("\0");
			return { sha, tree, authorDate, committerDate, message };
		});
	const turns = commits.filter((c) => /^turn:\d+$/.test(c.message));
	if (turns.length <= MAX_TURNS + TRIM_SLACK) return;

	const keepFrom = turns.length - MAX_TURNS;
	const firstKept = turns[keepFrom];
	if (!firstKept) return;
	const firstKeptIndex = commits.indexOf(firstKept);
	const baseOld = commits[firstKeptIndex - 1];
	const baseline = commits.find((c) => c.message === "initial");
	const parent = baseline && commits.indexOf(baseline) < firstKeptIndex ? baseline.sha : null;

	const baseArgs = ["commit-tree", baseOld?.tree ?? firstKept.tree];
	if (parent) baseArgs.push("-p", parent);
	baseArgs.push("-m", "trimmed");
	let head = (
		await runShadow(dir, cwd, baseArgs, 20000, {
			GIT_AUTHOR_DATE: baseOld?.authorDate ?? firstKept.authorDate,
			GIT_COMMITTER_DATE: baseOld?.committerDate ?? firstKept.committerDate,
		})
	).trim();

	for (let i = keepFrom; i < turns.length; i++) {
		const commit = turns[i] as LoggedCommit;
		head = (
			await runShadow(dir, cwd, ["commit-tree", commit.tree, "-p", head, "-m", commit.message], 20000, {
				GIT_AUTHOR_DATE: commit.authorDate,
				GIT_COMMITTER_DATE: commit.committerDate,
			})
		).trim();
	}
	await runShadow(dir, cwd, ["reset", "--soft", head], 10000);
	await reclaimHistory(dir, cwd);
}

export async function deleteCheckpointRepo(sessionId: string, cwd: string): Promise<void> {
	const dir = gitDir(sessionId, cwd);
	rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	const project = checkpointProjectDir(cwd);
	try {
		if (readdirSync(project).length === 0) rmdirSync(project);
	} catch {}
}

export async function createSnapshot(
	sessionId: string,
	cwd: string,
	message: string,
	opts?: { allowEmpty?: boolean; since?: number },
): Promise<Checkpoint | null> {
	const dir = gitDir(sessionId, cwd);
	await ensureRepo(dir, cwd);

	const deletedBeforeTurn = deletedAtTurnStart.get(sessionId);
	deletedAtTurnStart.delete(sessionId);
	const skip = readSkipSet(dir);
	for (const rel of [...skip]) if (!existsSync(join(cwd, rel))) skip.delete(rel);

	const status = await runShadow(
		dir,
		cwd,
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		120000,
	);
	const selected: string[] = [];
	for (const entry of statusEntries(status)) {
		for (const rel of entry.paths) {
			const stat = snapshotFileStat(cwd, rel);
			if (stat == null) {
				if (opts?.since != null && deletedBeforeTurn?.has(rel)) continue;
				selected.push(rel);
				continue;
			}
			if (isArtifactPath(rel) || (MAX_FILE_BYTES > 0 && stat.size > MAX_FILE_BYTES)) {
				skip.add(rel);
				continue;
			}
			if (opts?.since != null && stat.changedAt + 2000 < opts.since) continue;
			selected.push(rel);
		}
	}
	writeExclude(dir, skip);

	if (selected.length > 0) {
		const listPath = join(dir, ADD_LIST_FILE);
		writeFileSync(listPath, `${selected.map((rel) => `:(literal)${rel}`).join("\0")}\0`, "utf8");
		try {
			await runShadow(
				dir,
				cwd,
				["add", "-A", `--pathspec-from-file=${listPath}`, "--pathspec-file-nul"],
				120000,
			);
		} finally {
			try {
				unlinkSync(listPath);
			} catch {}
		}
	}

	const staged = await runShadow(dir, cwd, ["diff", "--cached", "--name-only"], 15000);
	if (staged.trim().length === 0) {
		if (opts?.allowEmpty !== true) return null;
		await runShadow(dir, cwd, ["commit", "--allow-empty", "-m", message], 30000);
	} else {
		await runShadow(dir, cwd, ["commit", "-m", message], 30000);
	}
	await maybeTrimHistory(dir, cwd).catch(() => {});
	const sha = (await runShadow(dir, cwd, ["rev-parse", "HEAD"], 10000)).trim();
	const time = (await runShadow(dir, cwd, ["show", "-s", "--format=%cI", "HEAD"], 10000)).trim();
	return { sha, message, time };
}

export async function listSnapshots(sessionId: string, cwd: string): Promise<Checkpoint[]> {
	const dir = gitDir(sessionId, cwd);
	if (!existsSync(dir)) return [];
	try {
		const out = await runShadow(dir, cwd, ["log", "--format=%H%x00%cI%x00%s"], 15000);
		return out
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => {
				const [sha = "", time = "", message = ""] = line.split("\0");
				const m = /^turn:(\d+)$/.exec(message);
				return { sha, time, message, turn: m ? Number(m[1]) : undefined };
			});
	} catch {
		return [];
	}
}

function unquoteGitPath(raw: string): string {
	const text = raw.trim();
	if (!(text.startsWith('"') && text.endsWith('"'))) return text;
	const body = text.slice(1, -1);
	const bytes: number[] = [];
	for (let i = 0; i < body.length; i++) {
		const ch = body[i] as string;
		if (ch !== "\\") {
			bytes.push(...Buffer.from(ch, "utf8"));
			continue;
		}
		const next = body[i + 1] ?? "";
		if (/[0-7]/.test(next)) {
			let oct = next;
			while (oct.length < 3 && /[0-7]/.test(body[i + 1 + oct.length] ?? "")) {
				oct += body[i + 1 + oct.length];
			}
			i += oct.length;
			bytes.push(Number.parseInt(oct, 8) & 0xff);
			continue;
		}
		i += 1;
		const plain = next === "t" ? "\t" : next === "n" ? "\n" : next === "r" ? "\r" : next;
		bytes.push(...Buffer.from(plain, "utf8"));
	}
	return Buffer.from(bytes).toString("utf8");
}

function splitHeaderTokens(rest: string, limit: number): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < rest.length && out.length < limit) {
		while (rest[i] === " ") i++;
		if (i >= rest.length) break;
		if (rest[i] === '"') {
			let j = i + 1;
			while (j < rest.length && !(rest[j] === '"' && rest[j - 1] !== "\\")) j++;
			out.push(rest.slice(i, Math.min(j + 1, rest.length)));
			i = j + 1;
			continue;
		}
		const space = rest.indexOf(" ", i);
		out.push(space < 0 ? rest.slice(i) : rest.slice(i, space));
		i = space < 0 ? rest.length : space + 1;
	}
	return out;
}

function pathFromDiffHeader(rest: string): string | null {
	if (rest.startsWith("a/")) {
		const splitAt = rest.indexOf(" b/", 1);
		if (splitAt > 0) {
			const aSide = rest.slice(0, splitAt);
			const bSide = rest.slice(splitAt + 1);
			if (`a/${bSide.slice(2)}` === aSide) return bSide.slice(2);
			const last = rest.lastIndexOf(" b/");
			if (last > 0 && last !== splitAt) return rest.slice(last + 3);
			return bSide.slice(2);
		}
	}
	const sides = splitHeaderTokens(rest, 2);
	const right = sides[1] ?? sides[0];
	if (!right) return null;
	const path = unquoteGitPath(right);
	if (path === "/dev/null") return null;
	return path.startsWith("b/") ? path.slice(2) : path.replace(/^a\//, "");
}

function pathFromMarker(raw: string): string | null {
	const path = unquoteGitPath(raw);
	if (!path || path === "/dev/null") return null;
	return path.startsWith("b/") || path.startsWith("a/") ? path.slice(2) : path;
}

export function filesFromCommitPatch(patch: string): GitWorkspaceFile[] {
	const lines = patch.split("\n");
	const files: GitWorkspaceFile[] = [];
	let from = -1;
	let headerPath: string | null = null;
	let newPath: string | null = null;
	let oldPath: string | null = null;
	let inHunk = false;
	const flush = (to: number) => {
		const path = newPath ?? oldPath ?? headerPath;
		if (from < 0 || path === null) return;
		const text = lines.slice(from, to).join("\n");
		const stat = patchStat(text);
		files.push({ path, added: stat.added, removed: stat.removed, untracked: false, patch: text });
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.startsWith("diff --git ")) {
			flush(i);
			from = i;
			headerPath = pathFromDiffHeader(line.slice("diff --git ".length));
			newPath = null;
			oldPath = null;
			inHunk = false;
			continue;
		}
		if (inHunk) continue;
		if (line.startsWith("@@ ")) {
			inHunk = true;
			continue;
		}
		if (line.startsWith("+++ ")) {
			newPath = pathFromMarker(line.slice(4));
		} else if (line.startsWith("--- ")) {
			oldPath = pathFromMarker(line.slice(4));
		}
	}
	flush(lines.length);
	return files;
}

export async function listSnapshotsWithDiff(
	sessionId: string,
	cwd: string,
): Promise<(Checkpoint & { files: GitWorkspaceFile[] })[]> {
	const snapshots = await listSnapshots(sessionId, cwd);
	if (snapshots.length === 0) return [];
	const dir = gitDir(sessionId, cwd);
	const filesList = await mapLimit(snapshots, 6, async (cp) => {
		if (cp.turn == null) return [];
		try {
			return filesFromCommitPatch(await commitPatch(dir, cwd, cp.sha));
		} catch {
			return [];
		}
	});
	return snapshots.map((cp, index) => ({ ...cp, files: filesList[index] ?? [] }));
}

export async function listSnapshotFiles(sessionId: string, cwd: string) {
	const dir = gitDir(sessionId, cwd);
	if (!existsSync(dir)) return [];
	try {
		const out = await runShadow(
			dir,
			cwd,
			["log", "--format=%x01%H%x00%cI%x00%s", "--name-only", "--no-renames"],
			20000,
		);
		return out
			.split("\x01")
			.slice(1)
			.map((chunk) => {
				const lines = chunk.split("\n");
				const [sha = "", time = "", message = ""] = (lines.shift() ?? "").split("\0");
				const files = [
					...new Set(
						lines
							.map((line) => line.trim())
							.filter(Boolean)
							.map(unquoteGitPath),
					),
				];
				const m = /^turn:(\d+)$/.exec(message);
				return { sha, time, message, turn: m ? Number(m[1]) : undefined, files };
			})
			.filter((cp) => cp.sha.length > 0);
	} catch {
		return [];
	}
}

const PATCH_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const PATCH_CACHE_MAX_ENTRY = 2 * 1024 * 1024;
const patchCache = new Map<string, string>();
let patchCacheBytes = 0;

function cacheKey(dir: string, sha: string): string {
	return `${dir}\0${sha}`;
}

function readCachedPatch(key: string): string | undefined {
	const hit = patchCache.get(key);
	if (hit === undefined) return undefined;
	patchCache.delete(key);
	patchCache.set(key, hit);
	return hit;
}

function writeCachedPatch(key: string, patch: string): void {
	if (patch.length > PATCH_CACHE_MAX_ENTRY) return;
	patchCache.set(key, patch);
	patchCacheBytes += patch.length;
	while (patchCacheBytes > PATCH_CACHE_MAX_BYTES) {
		const oldest = patchCache.keys().next();
		if (oldest.done) break;
		patchCacheBytes -= patchCache.get(oldest.value)?.length ?? 0;
		patchCache.delete(oldest.value);
	}
}

function commitPatch(dir: string, workTree: string, sha: string): Promise<string> {
	const key = cacheKey(dir, sha);
	const cached = readCachedPatch(key);
	if (cached !== undefined) return Promise.resolve(cached);
	return runShadow(dir, workTree, ["show", "--no-color", "--format=", "--patch", sha], 20000).then(
		(patch) => {
			writeCachedPatch(key, patch);
			return patch;
		},
	);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			out[index] = await fn(items[index] as T);
		}
	});
	await Promise.all(workers);
	return out;
}

function removeEmptyParents(root: string, rel: string): void {
	const base = resolve(root);
	let dir = dirname(join(base, rel));
	while (dir.length > base.length && dir.startsWith(base)) {
		try {
			rmdirSync(dir);
		} catch {
			return;
		}
		dir = dirname(dir);
	}
}

export async function restoreSnapshot(
	sessionId: string,
	cwd: string,
	sha: string,
): Promise<{ changed: boolean; files: string[] }> {
	const dir = gitDir(sessionId, cwd);
	if (!existsSync(dir)) throw new Error("该会话还没有检查点");

	const head = (await runShadow(dir, cwd, ["rev-parse", "HEAD"], 10000)).trim();
	if (head === sha) return { changed: false, files: [] };

	const diff = await runShadow(dir, cwd, ["diff", "--name-only", "-z", "--no-renames", head, sha], 20000);
	const paths = [...new Set(diff.split("\0").filter(Boolean))];
	if (paths.length === 0) {
		await runShadow(dir, cwd, ["reset", "--soft", sha], 10000);
		return { changed: false, files: [] };
	}

	const treeList = await runShadow(dir, cwd, ["ls-tree", "-r", "-z", "--name-only", sha], 30000);
	const inTarget = new Set(treeList.split("\0").filter(Boolean));
	const restorePaths = paths.filter((p) => inTarget.has(p));
	const removePaths = paths.filter((p) => !inTarget.has(p));

	await runShadow(dir, cwd, ["reset", "--soft", sha], 10000);
	await runShadow(dir, cwd, ["read-tree", sha], 30000);

	if (restorePaths.length > 0) {
		const listPath = join(dir, ADD_LIST_FILE);
		writeFileSync(listPath, `${restorePaths.map((p) => `:(literal)${p}`).join("\0")}\0`, "utf8");
		try {
			await runShadow(
				dir,
				cwd,
				["restore", "--source", sha, "--worktree", `--pathspec-from-file=${listPath}`, "--pathspec-file-nul"],
				60000,
			);
		} finally {
			try {
				unlinkSync(listPath);
			} catch {}
		}
	}
	for (const rel of removePaths) {
		try {
			unlinkSync(join(cwd, rel));
		} catch {}
		removeEmptyParents(cwd, rel);
	}
	void reclaimHistory(dir, cwd, "1.hour.ago");
	return { changed: true, files: paths.sort() };
}
