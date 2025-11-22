export default {
	"*.{js,ts,mjs,cjs,json,tsx,css,less,scss,vue,html,md}": ["cspell lint --no-error-on-empty"],
	"*.{js,ts,vue,md}": ["prettier --write", "eslint"]
};
