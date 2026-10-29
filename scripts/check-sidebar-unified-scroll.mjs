#!/usr/bin/env node

import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_ENV = 2;

const INITIAL_ROWS = 6;
const MORE_STEP = 16;

const ROW_HEIGHT = 31;
const TITLE_HEIGHT = 34;

const APP_SCAFFOLD_TOP = ".local";
const APP_SCAFFOLD_DIRS = [APP_SCAFFOLD_TOP, join(APP_SCAFFOLD_TOP, "agent-work")];
for (const leaf of ["channel", "plan", "spec"])
	APP_SCAFFOLD_DIRS.push(join(APP_SCAFFOLD_TOP, "agent-work", leaf));

const SAMPLE_KIND = "tcode/sidebar-unified-scroll-sample";
const SAMPLE_VERSION = 1;
const MANIFEST_NAME = ".tcode-check-sample.json";
const SAMPLES_DIR_NAME = "dev-samples";

const SAMPLE_GROUPS = [
	{
		label: "主样本组",
		count: 45,
		idPrefix: "01a1a1a1-1111-7111-8111-",
		namePrefix: "样本会话",
		dirName: "sidebar-unified-scroll-sample",
	},
	{
		label: "副样本组",
		count: 9,
		idPrefix: "01a2b2b2-2222-7222-8222-",
		namePrefix: "样本二组",
		dirName: "sidebar-second-sample",
	},
];
const SAMPLE_COUNT = SAMPLE_GROUPS[0].count;
const SAMPLE_NAME_PREFIX = SAMPLE_GROUPS[0].namePrefix;
const SAMPLE_SECOND_COUNT = SAMPLE_GROUPS[1].count;
const SAMPLE_SECOND_NAME_PREFIX = SAMPLE_GROUPS[1].namePrefix;

const DEV_PATHS = {
	agentDir: join(homedir(), ".pi", "agent-dev"),
	sessionsRoot: join(homedir(), ".pi", "agent-dev", "sessions"),
	trustFile: join(homedir(), ".pi", "agent-dev", "trust.json"),
};

const sessionDirFor = (sessionsRoot, cwd) =>
	join(sessionsRoot, `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);

function sampleSpec(paths) {
	const parent = join(paths.agentDir, SAMPLES_DIR_NAME);
	const projectDirs = SAMPLE_GROUPS.map((group) => join(parent, group.dirName));
	return {
		paths,
		parent,
		projectDirs,
		sessionDirs: projectDirs.map((cwd) => sessionDirFor(paths.sessionsRoot, cwd)),
		manifestFile: join(parent, MANIFEST_NAME),
	};
}

class SampleError extends Error {}

async function statOrNull(path) {
	try {
		return await stat(path);
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
}

async function readdirOrNull(path) {
	try {
		return await readdir(path);
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
}

async function readJsonOrNull(path) {
	const text = await readFile(path, "utf8").catch((err) => {
		if (err.code === "ENOENT") return null;
		throw err;
	});
	if (text === null) return null;
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new SampleError(`读不出 JSON（${path}）：${err.message}`);
	}
}

const sameStrings = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

async function findForeignScaffoldEntries(projectDir, allowedDirs) {
	const allowed = new Set(allowedDirs);
	const foreign = [];
	const walk = async (dir) => {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			const rel = relative(projectDir, full);
			if (!entry.isDirectory()) {
				foreign.push(`${rel}（非目录）`);
				continue;
			}
			if (!allowed.has(rel)) {
				foreign.push(`${rel}（陌生目录）`);
				continue;
			}
			await walk(full);
		}
	};
	await walk(join(projectDir, APP_SCAFFOLD_TOP));
	return foreign;
}

const entryId = (n) => n.toString(16).padStart(8, "0");

async function seedSample(spec) {
	const { paths, parent, projectDirs, sessionDirs, manifestFile } = spec;

	if (await statOrNull(manifestFile)) {
		throw new SampleError(
			`样本清单已存在（${manifestFile}）：已 seed 过或上次没清干净，先 --clean（或人工确认后删除）`,
		);
	}
	for (const dir of [...projectDirs, ...sessionDirs]) {
		if (await statOrNull(dir)) {
			throw new SampleError(`样本路径已存在（${dir}）：拒绝写进既有目录，人工确认后再处理`);
		}
	}
	const trust = (await readJsonOrNull(paths.trustFile)) ?? {};
	if (typeof trust !== "object" || trust === null || Array.isArray(trust)) {
		throw new SampleError(`trust.json 不是对象（${paths.trustFile}）：拒绝改写`);
	}
	for (const cwd of projectDirs) {
		if (Object.hasOwn(trust, cwd)) {
			throw new SampleError(
				`trust.json 里已有样本 cwd 的条目（${cwd}）：拒绝覆盖既有决定，人工确认后删除该键再 seed`,
			);
		}
	}

	await mkdir(parent, { recursive: true });
	await writeFile(
		manifestFile,
		`${JSON.stringify(
			{
				kind: SAMPLE_KIND,
				version: SAMPLE_VERSION,
				createdAt: new Date().toISOString(),
				projectDirs,
				sessionDirs,
				appScaffold: [APP_SCAFFOLD_TOP],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	for (const [index, group] of SAMPLE_GROUPS.entries()) {
		const cwd = projectDirs[index];
		await mkdir(cwd, { recursive: true });
		await mkdir(sessionDirs[index], { recursive: true });
		const base = Date.now() - group.count * 60_000;
		for (let i = 1; i <= group.count; i++) {
			const id = `${group.idPrefix}${String(i).padStart(12, "0")}`;
			const activity = base + i * 60_000;
			const iso = new Date(activity).toISOString();
			const name = `${group.namePrefix} ${String(i).padStart(2, "0")}`;
			const lines = [
				{ type: "session", version: 3, id, timestamp: iso, cwd },
				{ type: "session_info", id: entryId(1), parentId: null, timestamp: iso, name },
				{
					type: "message",
					id: entryId(2),
					parentId: entryId(1),
					timestamp: iso,
					message: {
						role: "user",
						content: [{ type: "text", text: `${name}：这是左栏验收用的样本提问。` }],
						timestamp: activity,
					},
				},
				{
					type: "message",
					id: entryId(3),
					parentId: entryId(2),
					timestamp: iso,
					message: {
						role: "assistant",
						content: [{ type: "text", text: `${name}：样本回答。` }],
						timestamp: activity + 1,
					},
				},
			];
			await writeFile(
				join(sessionDirs[index], `${iso.replace(/[:.]/g, "-")}_${id}.jsonl`),
				`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
				"utf8",
			);
		}
	}

	const next = { ...trust };
	for (const cwd of projectDirs) next[cwd] = true;
	await writeFile(paths.trustFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");

	return { projectDirs, sessionDirs, counts: SAMPLE_GROUPS.map((group) => group.count) };
}

async function cleanSample(spec) {
	const { paths, parent, projectDirs, sessionDirs, manifestFile } = spec;
	const manifest = await readJsonOrNull(manifestFile);
	const existing = [];
	for (const dir of [...projectDirs, ...sessionDirs]) {
		if (await statOrNull(dir)) existing.push(dir);
	}
	if (manifest === null) {
		if (existing.length > 0) {
			throw new SampleError(
				`没有样本清单（${manifestFile}）却存在样本路径：无法证明是本脚本创建的，拒绝删除。人工确认后可自行删除：${existing.join(", ")}`,
			);
		}
		return { removed: false };
	}
	if (manifest.kind !== SAMPLE_KIND || manifest.version !== SAMPLE_VERSION) {
		throw new SampleError(`样本清单 kind/version 不匹配（${manifestFile}）：拒绝删除`);
	}
	if (!sameStrings(manifest.projectDirs, projectDirs) || !sameStrings(manifest.sessionDirs, sessionDirs)) {
		throw new SampleError(`样本清单里的路径与本地推导不一致（${manifestFile}）：清单可能被篡改，拒绝删除`);
	}
	if (!sameStrings(manifest.appScaffold, [APP_SCAFFOLD_TOP])) {
		throw new SampleError(`样本清单里的 appScaffold 与本地约定不一致（${manifestFile}）：拒绝删除`);
	}

	for (const [index, dir] of sessionDirs.entries()) {
		const entries = await readdirOrNull(dir);
		if (entries === null) continue;
		const prefix = SAMPLE_GROUPS[index].idPrefix;
		const foreign = entries.filter((name) => name !== "traces" && !name.includes(prefix));
		if (foreign.length > 0) {
			throw new SampleError(`样本会话目录里有陌生条目（${dir}）：${foreign.join(", ")} → 拒绝删除任何东西`);
		}
		if (entries.includes("traces")) {
			const traces = await readdirOrNull(join(dir, "traces"));
			const traceForeign = (traces ?? []).filter((name) => !name.includes(prefix));
			if (traceForeign.length > 0) {
				throw new SampleError(
					`样本 traces 目录里有非样本文件（${join(dir, "traces")}）：${traceForeign.join(", ")} → 拒绝删除`,
				);
			}
		}
	}
	for (const dir of projectDirs) {
		const entries = await readdirOrNull(dir);
		if (entries === null) continue;

		const foreignTop = entries.filter((name) => name !== APP_SCAFFOLD_TOP);
		if (foreignTop.length > 0) {
			throw new SampleError(`样本项目目录里有陌生条目（${dir}）：${foreignTop.join(", ")} → 拒绝删除`);
		}
		if (entries.includes(APP_SCAFFOLD_TOP)) {
			const scaffoldDir = join(dir, APP_SCAFFOLD_TOP);
			if (!(await stat(scaffoldDir)).isDirectory()) {
				throw new SampleError(`样本项目目录里的 ${APP_SCAFFOLD_TOP} 不是目录（${scaffoldDir}）→ 拒绝删除`);
			}
			const foreign = await findForeignScaffoldEntries(dir, APP_SCAFFOLD_DIRS);
			if (foreign.length > 0) {
				throw new SampleError(
					`样本项目目录里的 ${APP_SCAFFOLD_TOP} 有意外内容（${scaffoldDir}）：${foreign.join(", ")} → 拒绝删除`,
				);
			}
		}
	}
	const trust = await readJsonOrNull(paths.trustFile);
	let nextTrust = null;
	if (trust !== null) {
		if (typeof trust !== "object" || Array.isArray(trust)) {
			throw new SampleError(`trust.json 不是对象（${paths.trustFile}）：拒绝改写`);
		}
		nextTrust = { ...trust };
		for (const cwd of projectDirs) {
			if (!Object.hasOwn(nextTrust, cwd)) continue;
			if (nextTrust[cwd] !== true) {
				throw new SampleError(
					`trust.json 里样本 cwd 的值已被改成 ${JSON.stringify(nextTrust[cwd])}（${cwd}）：拒绝覆盖，人工确认后自行处理`,
				);
			}
			delete nextTrust[cwd];
		}
	}

	for (const dir of sessionDirs) {
		const entries = await readdirOrNull(dir);
		if (entries === null) continue;
		for (const name of entries) {
			if (name === "traces") await rm(join(dir, "traces"), { recursive: true, force: true });
			else await rm(join(dir, name), { force: true });
		}
		await rmdir(dir);
	}
	for (const dir of projectDirs) {
		if (await statOrNull(dir)) await rm(dir, { recursive: true, force: true });
	}
	if (nextTrust !== null) await writeFile(paths.trustFile, `${JSON.stringify(nextTrust, null, 2)}\n`, "utf8");
	await rm(manifestFile, { force: true });
	await rmdir(parent).catch(() => {});
	return { removed: true };
}

async function selftest() {
	const cases = [];
	const tmpRoot = join(REPO_ROOT, ".local", "tmp");
	await mkdir(tmpRoot, { recursive: true });
	const beforeEntries = (await readdir(tmpRoot)).sort();
	const legacyFixed = join(tmpRoot, "check-sidebar-sample-selftest");
	const legacyOther = join(tmpRoot, "check-sidebar-sample-selftest-other");
	const legacyCreated = [];
	const legacyBefore = new Map();
	for (const legacy of [legacyFixed, legacyOther]) {
		if ((await statOrNull(legacy)) === null) {
			await mkdir(legacy, { recursive: true });

			await writeFile(join(legacy, "reviewer-diagnostics.txt"), "do not delete me\n", "utf8");
			legacyCreated.push(legacy);
		}
		legacyBefore.set(legacy, (await readdir(legacy)).sort().join(","));
	}
	const root = await mkdtemp(join(tmpRoot, "check-sidebar-selftest-"));
	const otherRoot = await mkdtemp(join(tmpRoot, "check-sidebar-selftest-other-"));
	const record = (label, ok, detail) => {
		cases.push({ label, ok: ok === true });
		console.log(`${ok ? "PASS" : "FAIL"} · ${label} · ${detail}`);
	};
	const reset = async () => {
		await rm(root, { recursive: true, force: true });
		await mkdir(join(root, "sessions"), { recursive: true });
		return sampleSpec({
			agentDir: root,
			sessionsRoot: join(root, "sessions"),
			trustFile: join(root, "trust.json"),
		});
	};
	const refused = async (label, run, matcher) => {
		try {
			await run();
			record(label, false, "没有按预期拒绝");
		} catch (err) {
			record(label, matcher.test(err.message), err.message);
		}
	};

	record(
		"自检的两个根是每轮新建的唯一目录（不是固定路径）",
		root !== legacyFixed && otherRoot !== legacyOther && root !== otherRoot,
		`${root} / ${otherRoot}`,
	);

	let spec = await reset();
	const seeded = await seedSample(spec);
	record(
		"空根 seed 成功并落下清单与 trust 条目",
		(await statOrNull(spec.manifestFile)) !== null &&
			(await readdirOrNull(spec.sessionDirs[0]))?.length === SAMPLE_COUNT &&
			(await readJsonOrNull(spec.paths.trustFile))?.[spec.projectDirs[0]] === true,
		`会话 ${seeded.counts.join("+")} 条 / 清单 ${MANIFEST_NAME} / trust ${SAMPLE_GROUPS.length} 个键`,
	);

	await refused("已 seed 过再 seed → 拒绝（不写既有目录）", () => seedSample(spec), /清单已存在/);

	const trustPath = spec.paths.trustFile;
	spec = await reset();
	await writeFile(trustPath, `${JSON.stringify({ [spec.projectDirs[0]]: true }, null, 2)}\n`, "utf8");
	await refused(
		"trust.json 已有样本 cwd 条目 → seed 拒绝（不覆盖既有决定）",
		() => seedSample(spec),
		/已有样本 cwd 的条目/,
	);
	record(
		"trust 冲突时没有创建任何样本路径",
		(await statOrNull(spec.manifestFile)) === null && (await statOrNull(spec.sessionDirs[0])) === null,
		"清单与会话目录都未创建",
	);

	spec = await reset();
	await seedSample(spec);
	const foreignFile = join(spec.sessionDirs[0], "2026-01-01T00-00-00-000Z_real-session.jsonl");
	await writeFile(foreignFile, "{}\n", "utf8");
	const beforeCount = (await readdir(spec.sessionDirs[0])).length;
	await refused("会话目录里有陌生文件 → clean 拒绝删除", () => cleanSample(spec), /陌生条目/);
	record(
		"拒绝后样本内容原样保留（什么都没删）",
		(await readdir(spec.sessionDirs[0])).length === beforeCount &&
			(await statOrNull(spec.manifestFile)) !== null &&
			(await statOrNull(foreignFile)) !== null,
		`目录内 ${beforeCount} 个条目未变`,
	);
	await rm(foreignFile, { force: true });

	await writeFile(join(spec.projectDirs[0], "unexpected.txt"), "x", "utf8");
	await refused("样本项目目录里有陌生文件 → clean 拒绝", () => cleanSample(spec), /陌生条目/);
	await rm(join(spec.projectDirs[0], "unexpected.txt"), { force: true });
	await mkdir(join(spec.projectDirs[0], ".local", "agent-work", "channel"), { recursive: true });
	await mkdir(join(spec.projectDirs[0], ".local", "agent-work", "spec"), { recursive: true });
	await mkdir(join(spec.projectDirs[0], ".local", "agent-work", "plan"), { recursive: true });
	record(
		"应用脚手架（.local/agent-work/{channel,spec,plan} 空目录）**不算**陌生内容",
		(await cleanSample(spec)).removed === true,
		"含脚手架的样本被正常清掉",
	);
	await reset();
	await seedSample(spec);

	const scaffold = join(spec.projectDirs[0], APP_SCAFFOLD_TOP, "agent-work");
	await mkdir(join(scaffold, "channel"), { recursive: true });
	await mkdir(join(scaffold, "plan"), { recursive: true });
	await mkdir(join(scaffold, "spec"), { recursive: true });
	await mkdir(join(scaffold, "docs"), { recursive: true });
	await refused("脚手架里多出未登记目录 → clean 拒绝", () => cleanSample(spec), /有意外内容/);
	await rmdir(join(scaffold, "docs"));
	await writeFile(join(scaffold, "channel", "MESSAGES.md"), "x", "utf8");
	await refused("脚手架里出现文件（如频道消息）→ clean 拒绝", () => cleanSample(spec), /有意外内容/);
	await rm(join(scaffold, "channel", "MESSAGES.md"), { force: true });

	const changed = JSON.parse(await readFile(trustPath, "utf8"));
	changed[spec.projectDirs[0]] = "someone-else";
	await writeFile(trustPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
	await refused("trust 值被改成非 true → clean 拒绝覆盖", () => cleanSample(spec), /值已被改成/);
	const restoredTrust = JSON.parse(await readFile(trustPath, "utf8"));
	restoredTrust[spec.projectDirs[0]] = true;
	await writeFile(trustPath, `${JSON.stringify(restoredTrust, null, 2)}\n`, "utf8");

	const tampered = JSON.parse(await readFile(spec.manifestFile, "utf8"));
	tampered.projectDirs = [join(root, "somewhere-else")];
	await writeFile(spec.manifestFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
	await refused("清单里的路径与本地推导不一致 → clean 拒绝", () => cleanSample(spec), /路径与本地推导不一致/);
	await rm(spec.manifestFile, { force: true });

	await refused("清单缺失但样本路径还在 → clean 拒绝", () => cleanSample(spec), /无法证明是本脚本创建的/);

	await reset();
	await seedSample(spec);
	await writeFile(join(spec.sessionDirs[0], "traces", "..keep"), "", "utf8").catch(() => {});
	const cleaned = await cleanSample(spec);
	record(
		"clean 删净自己创建的一切（会话目录 / 项目目录 / trust 键 / 清单）",
		cleaned.removed === true &&
			(await statOrNull(spec.sessionDirs[0])) === null &&
			(await statOrNull(spec.projectDirs[0])) === null &&
			(await statOrNull(spec.manifestFile)) === null &&
			(await readJsonOrNull(spec.paths.trustFile))?.[spec.projectDirs[0]] === undefined,
		"目录、清单、trust 键都已消失",
	);
	const again = await cleanSample(spec);
	record(
		"再 clean 一次是幂等的 no-op（不报错也不删东西）",
		again.removed === false,
		`removed=${again.removed}`,
	);

	await mkdir(join(otherRoot, "sessions"), { recursive: true });
	const otherSpec = sampleSpec({
		agentDir: otherRoot,
		sessionsRoot: join(otherRoot, "sessions"),
		trustFile: join(otherRoot, "trust.json"),
	});
	await seedSample(otherSpec);
	record(
		"隔离根之间互不影响（只删自己那份）",
		(await statOrNull(otherSpec.manifestFile)) !== null && otherSpec.projectDirs[0] !== spec.projectDirs[0],
		`另一根 ${otherRoot} 有自己的清单`,
	);
	await cleanSample(otherSpec);

	const legacyAfter = new Map();
	for (const legacy of [legacyFixed, legacyOther]) {
		legacyAfter.set(legacy, (await readdir(legacy)).sort().join(","));
	}
	const legacyUntouched = [...legacyBefore].every(([dir, before]) => legacyAfter.get(dir) === before);
	record(
		"历史固定路径下的既有内容没被自检碰过（条目逐一对照）",
		legacyUntouched,
		`${legacyFixed}、${legacyOther} 内条目与跑前逐个一致（${[...legacyBefore.values()].join(" | ")}）`,
	);

	await rm(root, { recursive: true, force: true });
	await rm(otherRoot, { recursive: true, force: true });
	const leftovers = (await readdir(tmpRoot)).filter((name) => name.startsWith("check-sidebar-selftest-"));
	record(
		"只删本轮创建的目录，且清完不留残（固定名按需还原）",
		leftovers.length === 0,
		`残留 ${leftovers.length} 个自检目录`,
	);
	const afterEntries = (await readdir(tmpRoot)).sort();
	const expected = [...beforeEntries, ...legacyCreated.map((dir) => dir.split("/").pop())].sort();
	record(
		".local/tmp 里其它条目（含预置的固定名目录）数量与名字未被改变",
		JSON.stringify(afterEntries) === JSON.stringify(expected),
		`跑前 ${beforeEntries.length} 项 → 跑后 ${afterEntries.length} 项（差额 = 本轮为用例临时预置的固定名目录 ${legacyCreated.length} 个，跑完已还原）`,
	);

	for (const legacy of legacyCreated) {
		await rm(join(legacy, "reviewer-diagnostics.txt"), { force: true });
		await rm(legacy, { recursive: true, force: true });
	}

	const failed = cases.filter((c) => !c.ok);
	console.log(
		`\n${cases.length - failed.length}/${cases.length} PASS（每轮唯一隔离根，已清理；未触碰 ~/.pi/agent-dev）`,
	);
	if (failed.length > 0) {
		console.log("失败项：");
		for (const f of failed) console.log(`  - ${f.label}`);
		process.exit(EXIT_FAIL);
	}
	process.exit(EXIT_OK);
}

const mode = process.argv[2];

if (mode === "--selftest") await selftest();

if (mode === "--seed" || mode === "--clean") {
	const spec = sampleSpec(DEV_PATHS);
	try {
		if (mode === "--seed") {
			const seeded = await seedSample(spec);
			console.log(`已写入样本：主组 ${seeded.counts[0]} 条 / 副组 ${seeded.counts[1]} 条`);
			for (const dir of [...spec.projectDirs, ...spec.sessionDirs]) console.log(`  ${dir}`);
			console.log(`样本清单：${spec.manifestFile}（清理只认它签名的东西）`);
			console.log("会话目录只在应用启动时读一次 → 请重启 dev，然后跑不带参数的验收。");
			console.log("用完清理：node scripts/check-sidebar-unified-scroll.mjs --clean（先停 dev）");
		} else {
			const cleaned = await cleanSample(spec);
			if (!cleaned.removed) {
				console.log("没有样本需要清理（既没有清单也没有样本路径残留）");
			} else {
				console.log("已删除本脚本创建的样本：会话目录 / 样本项目目录 / trust.json 条目 / 清单");
				console.log(
					"重启 dev 后左栏即恢复原样（样本 cwd 可能仍留在 ui-state 展开偏好里，不匹配任何组，无害）",
				);
			}
		}
		process.exit(EXIT_OK);
	} catch (err) {
		const kind = err instanceof SampleError ? "安全拒绝（什么都没改）" : "执行出错";
		console.error(`FAIL · ${kind}：${err.message}`);
		if (err instanceof SampleError) console.error("（fail-closed：不确认归属就绝不删改；确认后可人工处理）");
		process.exit(EXIT_FAIL);
	}
}
if (mode && mode !== "--check") {
	console.error(`未知参数 ${mode}：用法见本文件头部（退出码 ${EXIT_ENV}）`);
	process.exit(EXIT_ENV);
}

const RAW_PORT = process.env.CDP_PORT ?? "9224";
if (!/^\d+$/.test(RAW_PORT) || Number(RAW_PORT) < 1 || Number(RAW_PORT) > 65535) {
	console.error(`CDP_PORT 非法（${JSON.stringify(RAW_PORT)}）：应为 1–65535 的纯数字（退出码 ${EXIT_ENV}）`);
	process.exit(EXIT_ENV);
}
const PORT = Number(RAW_PORT);

async function findPage(timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(3000) });
			const list = await res.json();
			const found = list.find((x) => x.type === "page" && x.webSocketDebuggerUrl);
			if (found) return found;
		} catch {}
		await new Promise((r) => setTimeout(r, 400));
	}
	throw new Error(`等不到 page target（${PORT}）：dev 应用是否带 --remote-debugging-port=${PORT} 运行？`);
}

const page = await findPage().catch((err) => {
	console.error(`无法连接 CDP（退出码 ${EXIT_ENV}）：${err.message}`);
	process.exit(EXIT_ENV);
});
const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
	}
};
await new Promise((r) => (ws.onopen = r));
function send(method, params = {}) {
	return new Promise((resolve, reject) => {
		const id = ++msgId;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
}
async function evalJs(expression) {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(`页面内执行失败：${JSON.stringify(result.exceptionDetails)}`);
	return result.result?.value;
}

async function focusEmulation() {
	await send("Emulation.setFocusEmulationEnabled", { enabled: true });
}
await focusEmulation();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
	results.push({ name, ok: ok === true });
	console.log(`${ok ? "PASS" : "FAIL"} · ${name} · ${detail}`);
}
function note(text) {
	console.log(`     ${text}`);
}
function envExit(text) {
	console.error(`\nFAIL · 环境不满足：${text}（退出码 ${EXIT_ENV}）`);
	ws.close();
	process.exit(EXIT_ENV);
}

const ROOT = `document.querySelector("[data-sidebar-scroll-root]")`;
const groupExpr = (key) => `document.querySelector('[data-sidebar-group-key="${key}"]')`;

const samplePaths = sampleSpec(DEV_PATHS);
const SAMPLE_CWD = samplePaths.projectDirs[0];
const SAMPLE_SECOND_CWD = samplePaths.projectDirs[1];
const GROUP = groupExpr(SAMPLE_CWD);
const GROUP2 = groupExpr(SAMPLE_SECOND_CWD);
const TITLE = `${GROUP}?.querySelector("button[aria-expanded]")`;
const TITLE2 = `${GROUP2}?.querySelector("button[aria-expanded]")`;
const ROWS_IN_GROUP = (expr) => `${expr}?.querySelectorAll("[data-sidebar-session-list] [data-session-id]")`;
const SHOW_MORE = `${GROUP}?.querySelector("[data-sidebar-show-more]")`;
const SHOW_MORE2 = `${GROUP2}?.querySelector("[data-sidebar-show-more]")`;
const SEARCH_INPUT = `document.querySelector('aside.sidebar input[type="search"]')`;

const VISIBLE_ROW = `[...${ROOT}.querySelectorAll("[data-sidebar-session-list] [data-session-id]")].find((row) => {
	const r = row.getBoundingClientRect();
	const a = ${ROOT}.getBoundingClientRect();
	return r.top > a.top + 40 && r.bottom < a.bottom - 40;
})`;

function readGroup(expr = GROUP) {
	return evalJs(`(() => {
	const g = ${expr};
	if (!g) return JSON.stringify({ error: "no-group" });
	const content = g.querySelector("[data-sidebar-group-content]");
	const list = g.querySelector("[data-sidebar-session-list]");
	const rows = list ? [...list.querySelectorAll("[data-session-id]")] : [];
	const cs = list ? getComputedStyle(list) : null;
	const title = g.querySelector("button[aria-expanded]");
	return JSON.stringify({
		state: content?.getAttribute("data-sidebar-group-content") ?? null,
		rowCount: rows.length,
		firstRowId: rows[0]?.dataset.sessionId ?? null,
		lastRowId: rows[rows.length - 1]?.dataset.sessionId ?? null,
		activeIds: rows.filter((r) => r.dataset.sessionActive === "true").map((r) => r.dataset.sessionId),
		hasButton: !!g.querySelector("[data-sidebar-show-more]"),
		hasList: !!list,
		listOverflowY: cs?.overflowY ?? null,
		listMaxHeight: cs?.maxHeight ?? null,
		listScrollH: list?.scrollHeight ?? null,
		listClientH: list?.clientHeight ?? null,
		listScrollTop: list?.scrollTop ?? null,
		titleHeight: title ? Math.round(title.getBoundingClientRect().height) : null,
		titleInsideList: !!g.querySelector("[data-sidebar-session-list] button[aria-expanded]"),
		rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
	});
})()`).then(JSON.parse);
}

function readLists() {
	return evalJs(`(() => {
	return JSON.stringify([...document.querySelectorAll("[data-sidebar-session-list]")].map((el) => {
		const cs = getComputedStyle(el);
		return {
			rows: el.querySelectorAll("[data-session-id]").length,
			overflowY: cs.overflowY,
			maxHeight: cs.maxHeight,
			scrollH: el.scrollHeight,
			clientH: el.clientHeight,
			scrollTop: el.scrollTop,
		};
	}));
})()`).then(JSON.parse);
}

function positions() {
	return evalJs(`(() => {
	const root = ${ROOT};
	return JSON.stringify({
		outer: root.scrollTop,
		outerMax: root.scrollHeight - root.clientHeight,
		lists: [...document.querySelectorAll("[data-sidebar-session-list]")].map((l) => l.scrollTop),
	});
})()`).then(JSON.parse);
}

function scanInnerScrollers() {
	return evalJs(`(() => {
	const root = ${ROOT};
	const out = [];
	for (const el of root.querySelectorAll("*")) {
		const cs = getComputedStyle(el);
		const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
		const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
		if (y || x) out.push({ tag: el.tagName, overflowY: cs.overflowY, overflowX: cs.overflowX, scrollH: el.scrollHeight, clientH: el.clientHeight });
	}
	return JSON.stringify(out);
})()`).then(JSON.parse);
}

async function settle(timeoutMs = 1200) {
	const deadline = Date.now() + timeoutMs;
	let prev = JSON.stringify(await positions());
	while (Date.now() < deadline) {
		await sleep(90);
		const cur = JSON.stringify(await positions());
		if (cur === prev) return;
		prev = cur;
	}
}

async function waitFor(expr, { timeoutMs = 6000, label = expr } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await evalJs(`!!(${expr})`)) return true;
		await sleep(120);
	}
	throw new Error(`等待超时（${label}）`);
}

const waitGroupState = (state, expr = GROUP) =>
	waitFor(
		`${expr}?.querySelector("[data-sidebar-group-content]")?.getAttribute("data-sidebar-group-content") === "${state}"`,
		{ label: `分组展开态变为 ${state}` },
	);

const waitRowCount = (expected, expr = GROUP) =>
	waitFor(`${ROWS_IN_GROUP(expr)}?.length === ${expected}`, { label: `分组行数变为 ${expected}` });

async function centerOf(expr, { clampToRoot = true } = {}) {
	return JSON.parse(
		await evalJs(`(() => {
	const root = ${ROOT};
	const el = ${expr};
	if (!el) return JSON.stringify(null);
	const a = ${clampToRoot ? "root.getBoundingClientRect()" : "{ top: 0, left: 0, bottom: innerHeight, right: innerWidth }"};
	const r = el.getBoundingClientRect();
	const top = Math.max(r.top, a.top);
	const bottom = Math.min(r.bottom, a.bottom);
	const left = Math.max(r.left, a.left);
	const right = Math.min(r.right, a.right);
	const cx = (left + right) / 2;
	const cy = (top + bottom) / 2;
	const hit = document.elementFromPoint(cx, cy);
	return JSON.stringify({
		cx, cy,
		visibleHeight: bottom - top,
		visibleWidth: right - left,
		hitIsSelfOrChild: !!hit && (el === hit || el.contains(hit) || hit.contains(el)),
	});
})()`),
	);
}

async function reveal(expr) {
	await evalJs(
		`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: "center" }); return true; })()`,
	);
	await settle();
}

async function clickPoint(cx, cy) {
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx - 32, y: cy, button: "none" });
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none" });
	await send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: cx,
		y: cy,
		button: "left",
		clickCount: 1,
	});
	await send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: cx,
		y: cy,
		button: "left",
		clickCount: 1,
	});
	await sleep(120);
}

async function clickElement(expr, label = expr) {
	const c = await centerOf(expr);
	if (!c || c.visibleHeight < 6 || !c.hitIsSelfOrChild) {
		throw new Error(`目标不可点击（不可见或被遮挡）：${label} → ${JSON.stringify(c)}`);
	}
	await clickPoint(c.cx, c.cy);
}

async function wheelOn(expr, deltaY, times = 1) {
	const c = await centerOf(expr);
	if (!c || c.visibleHeight < 6 || !c.hitIsSelfOrChild) {
		throw new Error(`目标不可投递 wheel（不可见或被遮挡）：${expr} → ${JSON.stringify(c)}`);
	}
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.cx, y: c.cy, button: "none" });
	for (let i = 0; i < times; i++) {
		await send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: c.cx,
			y: c.cy,
			deltaX: 0,
			deltaY,
			pointerType: "mouse",
		});
		await sleep(70);
	}
	await settle();
}

async function clickTitle(label = "分组标题", titleExpr = TITLE) {
	await reveal(titleExpr);
	await clickElement(titleExpr, label);
}

async function wheelRootAt(expr, label = expr) {
	await reveal(expr);
	const before = await positions();
	const deltaY = before.outerMax - before.outer >= 80 ? 120 : -120;
	await wheelOn(expr, deltaY, 2);
	const after = await positions();
	const moved = deltaY > 0 ? after.outer > before.outer : after.outer < before.outer;
	check(
		`wheel 落在${label} → 只改变左栏主体 scrollTop`,
		moved && after.lists.every((top, i) => top === before.lists[i]),
		`主体 ${before.outer}→${after.outer}（deltaY ${deltaY}）/ 各列表 scrollTop ${after.lists.join(",")}`,
	);
}

async function wheelRootAnywhere() {
	const point = await evalJs(`(() => {
	const root = ${ROOT};
	const a = root.getBoundingClientRect();
	let fallback = null;
	for (let y = a.top + 6; y < a.bottom - 6; y += 4) {
		const x = a.left + 12;
		const hit = document.elementFromPoint(x, y);
		if (!hit || !root.contains(hit)) continue;
		if (!hit.closest("button")) return JSON.stringify({ x, y, tag: hit.tagName, text: (hit.innerText ?? "").trim().slice(0, 12) });
		fallback ??= { x, y, tag: hit.tagName, text: "" };
	}
	return JSON.stringify(fallback);
})()`).then(JSON.parse);
	if (!point) throw new Error("主体里找不到可投递 wheel 的落点");
	const before = await positions();
	const deltaY = before.outerMax - before.outer >= 80 ? 120 : -120;
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
	for (let i = 0; i < 2; i++) {
		await send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: point.x,
			y: point.y,
			deltaX: 0,
			deltaY,
			pointerType: "mouse",
		});
		await sleep(70);
	}
	await settle();
	return { before, after: await positions(), deltaY, point };
}

async function clickShowMore(times = 1, label = "「显示更多」按钮", buttonExpr = SHOW_MORE) {
	for (let i = 0; i < times; i++) {
		await reveal(buttonExpr);
		await clickElement(buttonExpr, label);
	}
}

async function resetSampleCount() {
	const g = await readGroup();
	if (g.state !== "expanded") {
		await clickTitle("样本组标题（展开）");
		await waitGroupState("expanded");
	}
	await clickTitle("样本组标题（折叠）");
	await waitGroupState("collapsed");
	await clickTitle("样本组标题（再展开）");
	await waitGroupState("expanded");
	await waitRowCount(INITIAL_ROWS);
	return readGroup();
}

async function setSearch(text) {
	const c = await centerOf(SEARCH_INPUT, { clampToRoot: false });
	if (!c || c.visibleHeight < 6) throw new Error("搜索框不可见，无法输入");
	await clickPoint(c.cx, c.cy);
	await evalJs(`(() => {
	const input = ${SEARCH_INPUT};
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(text)});
	input.dispatchEvent(new Event("input", { bubbles: true }));
	return input.value;
})()`);
	await settle();
	await waitFor(`${SEARCH_INPUT}.value === ${JSON.stringify(text)}`, {
		label: `搜索框值变为 ${JSON.stringify(text)}`,
	});
	await sleep(220);
}

console.log("=== 1. 环境与结构 ===");

await waitFor(`${ROOT} !== null && document.querySelector("aside.sidebar") !== null`, {
	timeoutMs: 25000,
	label: "左栏渲染出来（若一直等不到：确认只有一份 dev 实例 —— 9224 被别的实例占用时新实例开不了 devtools）",
});
const rootInfo = await evalJs(`(() => {
	const root = ${ROOT};
	const aside = document.querySelector("aside.sidebar");
	if (!root || !aside) return JSON.stringify({ error: "no-sidebar" });
	const cs = getComputedStyle(root);
	return JSON.stringify({
		collapsed: aside.classList.contains("is-collapsed"),
		asideWidth: Math.round(aside.getBoundingClientRect().width),
		clientH: root.clientHeight,
		clientW: root.clientWidth,
		scrollH: root.scrollHeight,
		scrollW: root.scrollWidth,
		overflowY: cs.overflowY,
	});
})()`).then(JSON.parse);
if (rootInfo.error) envExit("找不到左栏或 [data-sidebar-scroll-root]（Sidebar 的改动没进包/没生效）");
if (rootInfo.collapsed || rootInfo.asideWidth === 0) {
	envExit("左栏处于收起状态：先点顶栏左侧的开合按钮把左栏展开再跑（脚本不代点，避免误判）");
}
check(
	"左栏外层滚动容器存在且纵向可滚（环境前提）",
	rootInfo.overflowY === "auto",
	`overflowY ${rootInfo.overflowY} / clientH ${rootInfo.clientH} / scrollH ${rootInfo.scrollH}`,
);
check(
	"左栏外层无横向滚动",
	rootInfo.scrollW === rootInfo.clientW,
	`scrollW ${rootInfo.scrollW} / clientW ${rootInfo.clientW}`,
);

if ((await readGroup()).error === "no-group") {
	envExit(
		`左栏里没有主样本组（cwd=${SAMPLE_CWD}）：先停 dev → node scripts/check-sidebar-unified-scroll.mjs --seed → 重启 dev → 重跑`,
	);
}
if ((await readGroup(GROUP2)).error === "no-group") {
	envExit(
		`左栏里没有副样本组（cwd=${SAMPLE_SECOND_CWD}）：搜索换词 / 临时展开这些契约需要它，缺样本一律报环境不足（` +
			"先停 dev → node scripts/check-sidebar-unified-scroll.mjs --seed → 重启 dev → 重跑）",
	);
}

let group = await resetSampleCount();
check(
	"折叠再展开 → 该组回到 6 条（显示更多次数清零）",
	group.rowCount === INITIAL_ROWS && group.hasButton,
	`行数 ${group.rowCount} / 有「显示更多」=${group.hasButton}`,
);

const innerScrollers = await scanInnerScrollers();
check(
	"左栏滚动区内没有任何「自己还能滚」的元素（内层滚动已彻底移除）",
	innerScrollers.length === 0,
	innerScrollers.length === 0
		? "扫描主体全部后代：0 个可滚容器"
		: `仍有可滚元素：${JSON.stringify(innerScrollers)}`,
);

const lists = await readLists();
check(
	"所有会话列表容器自身不可滚（overflow 可见、无高度上限、scrollHeight = clientHeight）",
	lists.every((l) => l.overflowY === "visible" && l.maxHeight === "none" && l.scrollH === l.clientH),
	lists
		.map(
			(l, i) =>
				`#${i}:${l.rows}行 overflowY=${l.overflowY} maxH=${l.maxHeight} scrollH=${l.scrollH}/clientH=${l.clientH}`,
		)
		.join(" / "),
);
check(
	"分组标题行渲染在列表容器之外、行高 34px",
	group.titleHeight === TITLE_HEIGHT && group.titleInsideList === false,
	`标题行 ${group.titleHeight}px / 在列表容器内=${group.titleInsideList}`,
);
check(
	"会话行仍为 31px（分批不改变行高）",
	group.rowHeights.length > 0 && group.rowHeights.every((h) => h === ROW_HEIGHT),
	`行高 ${group.rowHeights.join("/") || "无行"}`,
);

await clickShowMore(3, "把样本组点满（撑高主体）");
const filled = await positions();
check("全显后主体可滚（后续滚动用例的环境前提）", filled.outerMax > 0, `可滚范围 ${filled.outerMax}px`);
if (filled.outerMax <= 0) envExit("主体撑到 45 行仍不可滚：窗口太高或其它组都折叠了，无法测滚动归属");

console.log("\n=== 2. 分批显示（6 → 22 → 38 → 全显）===");
group = await resetSampleCount();
check("0 次点击 → 6 条", group.rowCount === INITIAL_ROWS && group.hasButton, `行数 ${group.rowCount}`);
for (const [index, expected] of [INITIAL_ROWS + MORE_STEP, INITIAL_ROWS + MORE_STEP * 2].entries()) {
	await clickShowMore(1, `第 ${index + 1} 次点击「显示更多」`);
	await waitRowCount(expected);
	group = await readGroup();
	check(
		`${index + 1} 次点击 → ${expected} 条`,
		group.rowCount === expected && group.hasButton,
		`行数 ${group.rowCount}（期望 ${expected}）/ 有按钮=${group.hasButton}`,
	);
}
await clickShowMore(1, "第 3 次点击「显示更多」");
await waitRowCount(SAMPLE_COUNT);
group = await readGroup();
check(
	`第 3 次点击 → 全显 ${SAMPLE_COUNT} 条且按钮消失`,
	group.rowCount === SAMPLE_COUNT && !group.hasButton,
	`行数 ${group.rowCount}（期望 ${SAMPLE_COUNT}）/ 有按钮=${group.hasButton}`,
);
if (group.rowCount !== SAMPLE_COUNT) {
	envExit(
		`样本组只有 ${group.rowCount} 条会话（期望 ${SAMPLE_COUNT}）：样本没生成全或 dev 未重启 → --clean 后 --seed 再重启`,
	);
}

console.log("\n=== 2c. 「显示更多」的键盘可达性 ===");
{
	group = await resetSampleCount();
	const focusable = await evalJs(
		`(() => { const el = ${SHOW_MORE}; el.focus(); return document.activeElement === el; })()`,
	);
	check(
		"展开态：按钮在 Tab 序里（可以聚焦）",
		focusable === true,
		`focus() 后 activeElement 是它=${focusable}`,
	);

	const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
	await send("Input.dispatchKeyEvent", { type: "keyDown", ...enter, text: "\r", unmodifiedText: "\r" });
	await send("Input.dispatchKeyEvent", { type: "keyUp", ...enter });
	await sleep(200);
	group = await readGroup();
	const stillFocused = await evalJs(`document.activeElement === ${SHOW_MORE}`);
	check(
		"Enter 触发一次「显示更多」→ 22 条且焦点仍在按钮上",
		group.rowCount === INITIAL_ROWS + MORE_STEP && stillFocused === true,
		`行数 ${group.rowCount} / 焦点还在=${stillFocused}`,
	);

	await clickTitle("样本组标题（折叠）");
	await waitGroupState("collapsed");
	const focusableWhenCollapsed = await evalJs(
		`(() => { const el = ${SHOW_MORE}; el.focus(); return document.activeElement === el; })()`,
	);
	check(
		"折叠态：按钮不可聚焦（inert 生效，Tab 不会落到隐藏列表里）",
		focusableWhenCollapsed === false,
		`折叠态 focus() 后 activeElement 是它=${focusableWhenCollapsed}`,
	);
	await clickTitle("样本组标题（再展开）");
	await waitGroupState("expanded");
}

console.log("\n=== 2b. 侧栏整体收起再展开不重置分批计数 ===");
{
	const toggle = `document.querySelector("[data-sidebar-toggle]")`;

	await clickShowMore(3, "把样本组点满（侧栏开合用例的基线）");
	await waitRowCount(SAMPLE_COUNT);
	const before = await readGroup();
	const c = await centerOf(toggle, { clampToRoot: false });
	if (!c || c.visibleHeight < 6) envExit("找不到左栏开合按钮（[data-sidebar-toggle]）");
	await clickPoint(c.cx, c.cy);
	await waitFor(`document.querySelector("aside.sidebar")?.classList.contains("is-collapsed") === true`, {
		label: "左栏收起",
	});
	await sleep(320);
	const c2 = await centerOf(toggle, { clampToRoot: false });
	if (!c2 || c2.visibleHeight < 6) throw new Error("左栏收起后开合按钮不可点");
	await clickPoint(c2.cx, c2.cy);
	await waitFor(`document.querySelector("aside.sidebar")?.classList.contains("is-collapsed") === false`, {
		label: "左栏重新展开",
	});
	await sleep(320);
	const after = await readGroup();
	check(
		"收起再展开左栏 → 该组仍是 45 条（侧栏开合不算项目折叠，计数不重置）",
		before.rowCount === SAMPLE_COUNT && after.rowCount === before.rowCount && after.state === before.state,
		`行数 ${before.rowCount}→${after.rowCount} / state ${before.state}→${after.state}`,
	);
}

console.log("\n=== 3. 真实 wheel 只滚同一个主体 ===");

await resetSampleCount();
await clickShowMore(2, "降到 2 次点击（38 条，按钮仍在）");
await waitRowCount(INITIAL_ROWS + MORE_STEP * 2);

{
	await wheelRootAt(`${ROWS_IN_GROUP(GROUP)}[3]`, "会话行上");
	await wheelRootAt(TITLE, "项目标题行上");
	await wheelRootAt(SHOW_MORE, "「显示更多」按钮上");

	await evalJs(`${ROOT}.scrollTop = 0`);
	await settle();
	const blank = await wheelRootAnywhere();
	check(
		`wheel 落在左栏非交互区（<${blank.point.tag}> ${JSON.stringify(blank.point.text)}）→ 同样只滚主体`,
		blank.deltaY > 0 ? blank.after.outer > blank.before.outer : blank.after.outer < blank.before.outer,
		`落点 (${Math.round(blank.point.x)},${Math.round(blank.point.y)}) / 主体 ${blank.before.outer}→${blank.after.outer}`,
	);
	check(
		"非交互区落点的每次 wheel 都不改变任何列表自身的 scrollTop",
		blank.after.lists.every((top, i) => top === blank.before.lists[i]),
		`各列表 ${blank.before.lists.join(",")}→${blank.after.lists.join(",")}`,
	);

	await evalJs(`${ROOT}.scrollTop = Math.round((${ROOT}.scrollHeight - ${ROOT}.clientHeight) / 2)`);
	await settle();
	const beforeUp = await positions();
	await wheelOn(VISIBLE_ROW, -120, 2);
	const afterUp = await positions();
	check(
		"向上滚 → 主体回滚（正反方向归属一致）",
		afterUp.outer < beforeUp.outer && afterUp.lists.every((top) => top === 0),
		`主体 ${beforeUp.outer}→${afterUp.outer}`,
	);
}

console.log("\n=== 4. 头尾固定在滚动区之外 ===");
{
	const readHeaderFooter = () =>
		evalJs(`(() => {
	const inner = document.querySelector("aside.sidebar .sidebar-inner");
	const root = ${ROOT};
	const header = inner.firstElementChild;
	const footer = inner.lastElementChild;
	const h = header.getBoundingClientRect();
	const f = footer.getBoundingClientRect();
	return JSON.stringify({
		headerInsideRoot: root.contains(header),
		footerInsideRoot: root.contains(footer),
		headerTop: h.top,
		footerTop: f.top,
	});
})()`).then(JSON.parse);
	await evalJs(`${ROOT}.scrollTop = 0`);
	await settle();
	const before = await readHeaderFooter();
	const scrolled = await wheelRootAnywhere();
	const after = await readHeaderFooter();
	check(
		"新会话/搜索（头）与设置（尾）都在滚动区之外",
		before.headerInsideRoot === false && before.footerInsideRoot === false,
		`头在滚动区内=${before.headerInsideRoot} / 尾在滚动区内=${before.footerInsideRoot}`,
	);
	check(
		"滚主体时头尾不移动（固定）",
		after.headerTop === before.headerTop &&
			after.footerTop === before.footerTop &&
			scrolled.after.outer !== scrolled.before.outer,
		`头 ${before.headerTop}→${after.headerTop} / 尾 ${before.footerTop}→${after.footerTop} / 主体 ${scrolled.before.outer}→${scrolled.after.outer}`,
	);
}

console.log("\n=== 5. 搜索语义 ===");
{
	group = await resetSampleCount();
	await clickShowMore(3, "把主样本组点满，作为正常模式的基线");
	await waitRowCount(SAMPLE_COUNT);
	const base = await readGroup();
	check(
		"基线：主组正常模式 45 条（3 次点击）",
		base.rowCount === SAMPLE_COUNT && !base.hasButton,
		`行数 ${base.rowCount}`,
	);
	if ((await readGroup(GROUP2)).state === "expanded") {
		await clickTitle("副样本组标题（先折叠）", TITLE2);
		await waitGroupState("collapsed", GROUP2);
	}
	const secondBefore = await readGroup(GROUP2);
	check("基线：副样本组折叠", secondBefore.state === "collapsed", `state=${secondBefore.state}`);

	await setSearch(SAMPLE_SECOND_NAME_PREFIX);
	const secondSearched = await readGroup(GROUP2);
	check(
		"搜索命中折叠中的组 → 临时展开（不看持久化折叠偏好）",
		secondBefore.state === "collapsed" && secondSearched.state === "expanded",
		`搜索前 ${secondBefore.state} → 搜索时 ${secondSearched.state}`,
	);
	check(
		"搜索态计数独立：从 6 条开始（不是该组正常模式的次数）",
		secondSearched.rowCount === INITIAL_ROWS && secondSearched.hasButton,
		`行数 ${secondSearched.rowCount}（副组共 ${SAMPLE_SECOND_COUNT} 条）/ 有按钮=${secondSearched.hasButton}`,
	);
	check(
		"无命中的组被隐藏（搜索确实生效，不是输入没进去）",
		(await readGroup()).error === "no-group",
		`主组（无命中 ${JSON.stringify(SAMPLE_NAME_PREFIX)}）在搜索中不渲染=${(await readGroup()).error === "no-group"}`,
	);

	await clickShowMore(1, "搜索态的「显示更多」（副组）", SHOW_MORE2);
	await waitRowCount(SAMPLE_SECOND_COUNT, GROUP2);
	const afterMore = await readGroup(GROUP2);
	check(
		"搜索态点一次「显示更多」→ 副组全显",
		afterMore.rowCount === SAMPLE_SECOND_COUNT && !afterMore.hasButton,
		`行数 ${afterMore.rowCount}（期望 ${SAMPLE_SECOND_COUNT}）`,
	);
	await setSearch(`${SAMPLE_SECOND_NAME_PREFIX} 0`);
	await waitRowCount(INITIAL_ROWS, GROUP2);
	check(
		"搜索词 A→B：搜索态计数清零（回到 6 条）",
		(await readGroup(GROUP2)).rowCount === INITIAL_ROWS,
		`行数 ${(await readGroup(GROUP2)).rowCount}（期望 ${INITIAL_ROWS}）`,
	);

	await clickTitle("搜索态标题（临时折叠）", TITLE2);
	await waitGroupState("collapsed", GROUP2);
	await clickTitle("搜索态标题（重新展开）", TITLE2);
	await waitGroupState("expanded", GROUP2);
	await waitRowCount(INITIAL_ROWS, GROUP2);
	check(
		"搜索期间折叠再展开 → 回到 6 条（搜索态自己的计数被清）",
		(await readGroup(GROUP2)).rowCount === INITIAL_ROWS && (await readGroup(GROUP2)).hasButton,
		`行数 ${(await readGroup(GROUP2)).rowCount} / 有按钮=${(await readGroup(GROUP2)).hasButton}`,
	);
	await clickTitle("搜索态标题（再次临时折叠）", TITLE2);
	await waitGroupState("collapsed", GROUP2);
	await setSearch(SAMPLE_SECOND_NAME_PREFIX);
	await waitGroupState("expanded", GROUP2);
	await waitRowCount(INITIAL_ROWS, GROUP2);
	check(
		"搜索词换回 A：临时折叠被清掉（该组重新展开）",
		(await readGroup(GROUP2)).state === "expanded" && (await readGroup(GROUP2)).rowCount === INITIAL_ROWS,
		`state=${(await readGroup(GROUP2)).state} / 行数 ${(await readGroup(GROUP2)).rowCount}`,
	);

	await setSearch("");
	await waitGroupState("collapsed", GROUP2);
	const secondCleared = await readGroup(GROUP2);
	const mainCleared = await readGroup();
	check(
		"清空搜索 → 副组回到搜索前的折叠态（临时展开未写回持久化偏好）",
		secondCleared.state === "collapsed",
		`state=${secondCleared.state}（搜索前 collapsed）`,
	);
	check(
		"清空搜索 → 主组正常模式的计数未被搜索点击污染（仍 45 条）",
		mainCleared.rowCount === SAMPLE_COUNT && !mainCleared.hasButton && mainCleared.state === "expanded",
		`行数 ${mainCleared.rowCount}（期望 ${SAMPLE_COUNT}）/ state=${mainCleared.state}`,
	);
	const searchValue = await evalJs(`${SEARCH_INPUT}.value`);
	check("搜索框已清空", searchValue === "", `input.value=${JSON.stringify(searchValue)}`);
}

console.log("\n=== 6. reload 后：显示更多次数清零、展开偏好保留 ===");
{
	group = await readGroup();
	check(
		"reload 前的基线：该组展开且 45 条（3 次点击）",
		group.state === "expanded" && group.rowCount === SAMPLE_COUNT,
		`state=${group.state} / 行数 ${group.rowCount}`,
	);
	await sleep(700);
	await send("Page.reload", {});
	await sleep(500);
	await focusEmulation();
	await waitFor(`${GROUP} !== null`, { timeoutMs: 25000, label: "reload 后样本组重新渲染出来" });
	await waitGroupState("expanded");
	const after = await readGroup();
	check(
		"reload（等价重启）后该组回到 6 条 —— 分批计数只在内存里",
		after.rowCount === INITIAL_ROWS && after.hasButton,
		`行数 ${after.rowCount} / 有按钮=${after.hasButton}`,
	);
	check("reload 后展开偏好仍保留（组还是展开的）", after.state === "expanded", `state=${after.state}`);
	check(
		"reload 后副组仍折叠（搜索期间的临时展开没有被持久化）",
		(await readGroup(GROUP2)).state === "collapsed",
		`副组 state=${(await readGroup(GROUP2)).state}`,
	);
}

console.log("\n=== 7. 当前活跃会话超出已显示范围时不破例 ===");
{
	await clickShowMore(3, "全显样本组（准备点最后一条）");
	await waitRowCount(SAMPLE_COUNT);
	group = await readGroup();
	const lastId = group.lastRowId;
	const lastIndex = group.rowCount - 1;
	const lastRow = `${ROWS_IN_GROUP(GROUP)}[${lastIndex}]`;
	await reveal(lastRow);
	await clickElement(lastRow, "最后一条样本会话（最旧）");
	await waitFor(
		`${GROUP}?.querySelector('[data-session-id="${lastId}"][data-session-active="true"]') !== null`,
		{
			timeoutMs: 15000,
			label: `最后一条样本会话变为 active（${lastId}）`,
		},
	);

	await clickTitle("样本组标题（折叠）");
	await waitGroupState("collapsed");
	await clickTitle("样本组标题（再展开）");
	await waitGroupState("expanded");
	await waitRowCount(INITIAL_ROWS);
	group = await readGroup();
	check(
		"active 会话排在 6 条之外时不额外露出（行数仍是 6、active 行不在 DOM 里）",
		group.rowCount === INITIAL_ROWS && !group.activeIds.includes(lastId),
		`行数 ${group.rowCount} / 已显示的 active 行=${JSON.stringify(group.activeIds)}（最后一条 = ${lastId}）`,
	);
	note("排序按最后活动时间；点开历史会话不产生新活动，所以它仍在最末位");
}

console.log("\n=== 8. 右键菜单随滚动关闭 ===");
{
	await clickShowMore(3, "把样本组点满（让主体可滚）");
	await waitRowCount(SAMPLE_COUNT);
	const rowExpr = `${ROWS_IN_GROUP(GROUP)}[1]`;
	await reveal(rowExpr);
	const c = await centerOf(rowExpr);
	if (!c || c.visibleHeight < 6) envExit("会话行不可见，无法开右键菜单");
	await send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: c.cx,
		y: c.cy,
		button: "right",
		clickCount: 1,
	});
	await send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: c.cx,
		y: c.cy,
		button: "right",
		clickCount: 1,
	});
	await waitFor(`document.querySelector('[role="menu"]') !== null`, { label: "会话行右键菜单出现" });

	const before = await positions();
	const deltaY = before.outerMax - before.outer >= 80 ? 120 : -120;
	const point = await evalJs(`(() => {
	const root = ${ROOT};
	const menu = document.querySelector('[role="menu"]')?.getBoundingClientRect();
	const a = root.getBoundingClientRect();
	for (let y = a.top + 8; y < a.bottom - 8; y += 6) {
		const x = a.left + 12;
		const blocked = menu && x >= menu.left - 4 && x <= menu.right + 4 && y >= menu.top - 4 && y <= menu.bottom + 4;
		const hit = document.elementFromPoint(x, y);
		if (!blocked && hit && root.contains(hit) && !document.querySelector('[role="menu"]')?.contains(hit)) {
			return JSON.stringify({ x, y });
		}
	}
	return JSON.stringify(null);
})()`).then(JSON.parse);
	if (!point) envExit("左栏内找不到不被右键菜单遮挡的滚动落点");
	if (before.outer === before.outerMax && before.outer === 0)
		envExit("主体不可滚，无法验证右键菜单随滚动关闭");

	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
	for (let i = 0; i < 2; i++) {
		await send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: point.x,
			y: point.y,
			deltaX: 0,
			deltaY,
			pointerType: "mouse",
		});
		await sleep(70);
	}
	await settle();
	const after = await positions();
	const menuGone = (await evalJs(`document.querySelector('[role="menu"]') === null`)) === true;
	const moved = deltaY > 0 ? after.outer > before.outer : after.outer < before.outer;
	check(
		"右键菜单打开后滚动主体 → 菜单关闭且主体真的滚了",
		menuGone && moved,
		`菜单还在=${!menuGone} / 主体 ${before.outer}→${after.outer}（deltaY ${deltaY}）`,
	);
}

await setSearch("");
await evalJs(`${ROOT}.scrollTop = 0`);
await settle();
check("收尾：主体 scrollTop 复位为 0", (await positions()).outer === 0, `outer=${(await positions()).outer}`);

ws.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
	console.log("失败项：");
	for (const f of failed) console.log(`  - ${f.name}`);
	process.exit(EXIT_FAIL);
}
console.log("统一滚动 + 分批显示验收通过。样本清理：先停 dev，再跑 --clean");
process.exit(EXIT_OK);
