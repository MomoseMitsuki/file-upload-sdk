export function hasProp(obj: Record<string, any>, props: Array<string>) {
	for (const prop of props) {
		if (typeof obj[prop] === "undefined") {
			return false;
		}
	}
	return true;
}

const uploadRegExp = /^\/upload/;
const downloadRegExp = /^\/download/;
const mediaRegExp = /^\/media/;
const deleteRegExp = /^\/delete/;

export function isCreateFileRequest(headers: Record<string, any>, path: string) {
	const p = hasProp(headers, ["upload-file-size", "upload-file-name", "upload-file-mime"]);
	return p && uploadRegExp.test(path);
}

export function isPatchHashRequest(headers: Record<string, any>, path: string) {
	const p = hasProp(headers, ["upload-token", "upload-hash-type", "upload-hash"]);
	return p && uploadRegExp.test(path);
}

export function isMergeFileRequest(headers: Record<string, any>, path: string) {
	const p = hasProp(headers, ["upload-token", "upload-operation"]);
	return p && uploadRegExp.test(path);
}

export function isUploadChunkRequest(headers: Record<string, any>, path: string) {
	const p = hasProp(headers, ["upload-token", "upload-chunk-index", "upload-hash", "content-length", "content-type"]);
	return p && uploadRegExp.test(path);
}

export function isMediaStreamRequest(headers: Record<string, any>, path: string) {
	const p = hasProp(headers, ["range"]);
	return p && mediaRegExp.test(path);
}

export function isDownLoadFileRequest(path: string) {
	return downloadRegExp.test(path);
}

export function isDeleteFileRequest(path: string) {
	return deleteRegExp.test(path);
}
