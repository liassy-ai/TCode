import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig((env) => ({
	main: {
		define: {
			__COMPONENT_SHA256__: JSON.stringify(process.env.TCODE_COMPONENT_SHA256 ?? ""),
			__DEV_BUILD__: JSON.stringify(env.command === "serve"),
		},
		plugins: [externalizeDepsPlugin({ exclude: ["@tcode/backend", "@tcode/shared"] })],
		build: {
			minify: "esbuild",
			rollupOptions: {
				external: ["@earendil-works/pi-coding-agent"],
			},
		},
		resolve: {
			alias: {
				"@tcode/backend": resolve(__dirname, "../backend/src/index.ts"),
				"@tcode/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin({ exclude: ["@tcode/shared"] })],
		build: {
			rollupOptions: {
				output: {
					format: "cjs",
					entryFileNames: "index.cjs",
				},
			},
		},
		resolve: {
			alias: {
				"@tcode/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	renderer: {
		server: {
			host: "127.0.0.1",
			port: Number(process.env.PI_DEV_PORT || 5173),
		},
		resolve: {
			alias: {
				"@tcode/shared": resolve(__dirname, "../shared/src/index.ts"),
				"@renderer": resolve(__dirname, "src/renderer/src"),
			},
		},
		plugins: [react(), tailwindcss()],
	},
}));
