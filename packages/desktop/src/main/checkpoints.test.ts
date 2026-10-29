import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/tcode-checkpoints-test" } }));

import { filesFromCommitPatch } from "./checkpoints";

const COMMIT_PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2 changed
+line3 added
 line4
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+alpha
+beta
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-alpha
-beta
diff --git "a/\\344\\270\\255\\346\\226\\207.txt" "b/\\344\\270\\255\\346\\226\\207.txt"
index 5555555..6666666 100644
--- "a/\\344\\270\\255\\346\\226\\207.txt"
+++ "b/\\344\\270\\255\\346\\226\\207.txt"
@@ -1 +1 @@
-old
+new
diff --git a/img.png b/img.png
index 7777777..8888888 100644
Binary files a/img.png and b/img.png differ
`;

describe("filesFromCommitPatch：整条 commit 的 patch → 分文件", () => {
	it("每个文件一段：路径、加/减行数、patch 文本都按文件切好", () => {
		const files = filesFromCommitPatch(COMMIT_PATCH);
		expect(files.map((f) => f.path)).toEqual([
			"src/a.ts",
			"src/new.ts",
			"src/gone.ts",
			"中文.txt",
			"img.png",
		]);
		expect(files.map((f) => [f.added, f.removed])).toEqual([
			[2, 1],
			[2, 0],
			[0, 2],
			[1, 1],
			[0, 0],
		]);

		expect(files[0]?.patch).toContain("diff --git a/src/a.ts b/src/a.ts");
		expect(files[0]?.patch).not.toContain("src/new.ts");
		expect(files[1]?.patch?.startsWith("diff --git a/src/new.ts")).toBe(true);
		expect(files[3]?.patch).toContain("+new");

		expect(files[4]?.patch).toContain("Binary files");
	});

	it("新增文件只有 +++ 一侧、删除文件只有 --- 一侧：两边都能取到路径", () => {
		const files = filesFromCommitPatch(COMMIT_PATCH);
		expect(files.find((f) => f.path === "src/new.ts")).toBeTruthy();
		expect(files.find((f) => f.path === "src/gone.ts")).toBeTruthy();

		expect(files.some((f) => f.path.includes("dev/null"))).toBe(false);
	});

	it("带引号的路径（空格）解出真实文件名", () => {
		const patch = `diff --git "a/my file.txt" "b/my file.txt"
index 1..2 100644
--- "a/my file.txt"
+++ "b/my file.txt"
@@ -1 +1 @@
-x
+y
`;
		expect(filesFromCommitPatch(patch).map((f) => f.path)).toEqual(["my file.txt"]);
	});

	it("空 patch（空提交 / 无改动）切成空列表", () => {
		expect(filesFromCommitPatch("")).toEqual([]);
		expect(filesFromCommitPatch("\n")).toEqual([]);
	});

	it("纯改名没有任何 hunk（也就没有 ---/+++ 行）：仍要按头里的新名收进来", () => {
		const patch = `diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
`;
		const files = filesFromCommitPatch(patch);
		expect(files.map((f) => f.path)).toEqual(["new.txt"]);
		expect(files[0]?.added).toBe(0);
		expect(files[0]?.removed).toBe(0);
	});
});
