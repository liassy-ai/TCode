import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "esbuild";

let esbuildPromise: Promise<typeof import("esbuild")> | null = null;

export function loadEsbuild(): Promise<typeof import("esbuild")> {
	if (!esbuildPromise) {
		const bin = process.platform === "win32" ? "esbuild.exe" : "esbuild";
		const unpacked = join(
			process.resourcesPath ?? "",
			`app.asar.unpacked/node_modules/@esbuild/${process.platform}-${process.arch}/bin/${bin}`,
		);
		const patched = existsSync(unpacked);
		const prev = process.env.ESBUILD_BINARY_PATH;
		if (patched) process.env.ESBUILD_BINARY_PATH = unpacked;
		esbuildPromise = import("esbuild").then((mod) => {
			if (patched) {
				if (prev === undefined) delete process.env.ESBUILD_BINARY_PATH;
				else process.env.ESBUILD_BINARY_PATH = prev;
			}
			return mod;
		});
	}
	return esbuildPromise;
}

const SHIMS: Record<string, string> = {
	react: `
const R = window.TcodeUI.React;
export default R;
export const { Children, Component, Fragment, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef, isValidElement,
  lazy, memo, startTransition, use, useActionState, useCallback, useContext,
  useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle,
  useInsertionEffect, useLayoutEffect, useMemo, useOptimistic, useReducer, useRef,
  useState, useSyncExternalStore, useTransition, version } = R;`,

	"react/jsx-runtime": `
const J = window.TcodeUI.jsxRuntime;
export const { jsx, jsxs, Fragment } = J;`,

	"react-dom": `
const D = window.TcodeUI.ReactDOM;
export default D;
export const { createPortal, flushSync } = D;`,

	"@tcode/plugin-api": `
const A = window.TcodeUI;
export default A;
export const { version, components, helpers, hooks, stores } = A;
export const { Button, Dropdown, Tooltip, Markdown, ImagePreview } = A.components;
export const { summarizeArgs, displayToolName } = A.helpers;
export const { useT, useContextUsage, useQuota, useLanguage } = A.hooks;
export const { useTranscriptStore, useSessionsStore, useUiStore, useProjectsStore, useSettingsStore, useUiPreferencesStore } = A.stores;`,
};

const tcodeExternalsPlugin: Plugin = {
	name: "tcode-externals",
	setup(build) {
		build.onResolve({ filter: /^(react|react\/jsx-runtime|react-dom|@tcode\/plugin-api)$/ }, (args) => ({
			path: args.path,
			namespace: "tcode-external",
		}));
		build.onLoad({ filter: /.*/, namespace: "tcode-external" }, (args) => ({
			contents: SHIMS[args.path],
			loader: "js",
		}));
	},
};

const ASSET_LOADERS: Record<string, "dataurl"> = {
	".png": "dataurl",
	".webp": "dataurl",
	".gif": "dataurl",
	".jpg": "dataurl",
	".jpeg": "dataurl",
	".mp3": "dataurl",
	".m4a": "dataurl",
	".aac": "dataurl",
	".ogg": "dataurl",
	".wav": "dataurl",
};

export async function buildPlugin(
	pluginDir: string,
	mainEntry: string,
	options?: { outDir?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
	const outDir = options?.outDir ?? join(pluginDir, "dist");
	try {
		const { build } = await loadEsbuild();
		await build({
			entryPoints: [join(pluginDir, mainEntry)],
			bundle: true,
			format: "esm",
			outfile: join(outDir, "index.js"),
			jsx: "automatic",
			platform: "browser",
			target: "chrome140",
			sourcemap: false,
			minify: false,
			logLevel: "silent",
			loader: ASSET_LOADERS,
			plugins: [tcodeExternalsPlugin],
		});
		return { ok: true };
	} catch (err) {
		const esbuildErr = err as {
			errors?: { text?: string; location?: { file?: string; line?: number; column?: number } }[];
		};
		const first = esbuildErr.errors?.[0];
		const text = first?.text ?? String(err);
		const location = first?.location
			? ` (${first.location.file}:${first.location.line}:${first.location.column})`
			: "";
		return { ok: false, error: `${text}${location}`.replace(/\n/g, " ").slice(0, 500) };
	}
}
