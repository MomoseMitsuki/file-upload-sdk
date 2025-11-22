import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const ignores = ["**/dist/**", "**/node_modules/**", ".*", "scripts/**", "**/*.d.ts"];

export default defineConfig(
	// 通用配置
	{
		ignores, // 忽略项
		extends: [eslint.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier], // 继承规则
		plugins: {
			prettier: eslintPluginPrettier
		},
		languageOptions: {
			ecmaVersion: "latest", // ecma语法支持版本
			sourceType: "module", // 模块化类型
			parser: tseslint.parser // 解析器
		},
		rules: {
			// 自定义
		}
	},
	// upload-client配置
	{
		ignores,
		files: ["packages/upload-client/**/*.{ts,js,tsx,jsx,vue}", "packages/components/**/*.{ts,js,tsx,jsx,vue}"],
		extends: [eslintConfigPrettier],
		languageOptions: {
			globals: {
				...globals.browser
			}
		}
	},
	// upload-server配置
	{
		ignores,
		files: ["packages/upload-server/**/*.{ts,js}"],
		languageOptions: {
			globals: {
				...globals.node
			}
		}
	}
);
