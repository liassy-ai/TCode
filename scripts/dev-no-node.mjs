import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "node_modules", "electron-vite", "bin", "electron-vite.js");

delete process.env.ELECTRON_RUN_AS_NODE;

const passthrough = process.argv.slice(2);
process.argv = [process.argv[0], cli, ...(passthrough.length > 0 ? passthrough : ["dev"])];

await import(pathToFileURL(cli).href);
