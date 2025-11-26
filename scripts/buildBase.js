import path from "node:path";
import URL from "node:url";
import fs from "node:fs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "rollup-plugin-typescript2";

const __filename = URL.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packages = ["upload-core", "upload-protocol", "upload-client", "upload-server"];

function getPackageRoots() {
	return packages.map(pkg => path.resolve(__dirname, "../packages", pkg));
}

async function packageJson(root) {
	const jsonPath = path.resolve(root, "package.json");
	const content = await fs.promises.readFile(jsonPath, "utf-8");
	return JSON.parse(content);
}

async function getRollupConfig(root) {
	const config = await packageJson(root);
	const tsconfig = path.resolve(root, "tsconfig.json");
	const { name, formats, external, entries } = config.buildOptions || {};
	const dist = path.resolve(root, "./dist");
	for (const key in entries) {
		entries[key] = path.resolve(root, "./src", entries[key]);
	}

	const rollupOptions = {
		input: entries,
		sourcemap: true,
		plugins: [
			nodeResolve({
				preferBuiltins: true
			}),
			commonjs(),
			typescript({
				tsconfig,
				compilerOptions: {
					outDir: dist
				}
			})
		],
		dir: dist,
		external
	};
	const output = [];
	for (const format of formats) {
		const outputItem = {
			format,
			dir: dist,
			entryFileNames: format === "cjs" ? `[name].${format}` : `[name].${format}.js`,
			sourcemap: true
		};
		if (format === "iife") {
			outputItem.name = name;
		}
		output.push(outputItem);
	}
	rollupOptions.output = output;
	// watch options
	rollupOptions.watch = {
		include: path.resolve(root, "src/**"),
		exclude: path.resolve(root, "node_modules/**"),
		clearScreen: false
	};
	return rollupOptions;
}

export async function getRollupConfigs() {
	const roots = getPackageRoots();
	const configs = await Promise.all(roots.map(getRollupConfig));
	const result = {};
	for (let i = 0; i < packages.length; i++) {
		result[packages[i]] = configs[i];
	}
	return result;
}

export function clearDist(name) {
	const dist = path.resolve(__dirname, "../packages", name, "dist");
	if (fs.existsSync(dist)) {
		fs.rmSync(dist, { recursive: true, force: true });
	}
}
