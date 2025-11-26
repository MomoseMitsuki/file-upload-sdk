import type Koa from "Koa";
import type {
	CreateFileRequestHeader,
	PatchHashRequestHeader,
	MergeFileRequestHeader,
	UploadChunkHeader
} from "@momosemitsuki/upload-protocol";
import {
	isCreateFileRequest,
	isPatchHashRequest,
	isMergeFileRequest,
	isUploadChunkRequest,
	isDownLoadFileRequest,
	isMediaStreamRequest,
	isDeleteFileRequest
} from "../util.js";
import {
	createFileService,
	patchFileHashService,
	mergeFileService,
	checkFileService,
	pipeChunksStream,
	signFileToken,
	deleteFileService
} from "../services/fileService.js";
import { patchChunkHashService, uploadChunkService } from "../services/chunkService.js";
import { PassThrough } from "node:stream";

export function createFileMiddleWare(chunkSize = 1024 * 1024 * 5) {
	return async (ctx: Koa.Context, next: Koa.Next) => {
		if (isCreateFileRequest(ctx.headers, ctx.path)) {
			const header = ctx.headers as CreateFileRequestHeader;
			const token = signFileToken(header);
			// todo: 创建文件
			const url = ctx.path.replace(/^\/upload/, "");
			// 上传地址 /upload/资料/web前端   ->    /资料/web前端
			const { "upload-file-size": size, "upload-file-name": name, "upload-file-mime": type } = header;
			const resp = await createFileService(url, name, type, "undefined", token, Number(size), chunkSize);
			ctx.status = 200;
			ctx.body = resp;
		} else {
			await next();
		}
	};
}

export function patchHashMiddleWare() {
	return async (ctx: Koa.Context, next: Koa.Next) => {
		if (isPatchHashRequest(ctx.headers, ctx.path)) {
			const header = ctx.headers as PatchHashRequestHeader;
			const { "upload-hash-type": type, "upload-hash": hash, "upload-token": token } = header;
			if (type === "chunk") {
				const resp = await patchChunkHashService(hash);
				ctx.body = resp;
			} else {
				// 比对 file hash
				const resp = await patchFileHashService(token, hash);
				ctx.body = resp;
			}
		} else {
			await next();
		}
	};
}

export function mergeFileMiddleWare() {
	return async (ctx: Koa.Context, next: Koa.Next) => {
		if (isMergeFileRequest(ctx.header, ctx.path)) {
			const header = ctx.headers as MergeFileRequestHeader;
			const { "upload-token": token } = header;
			// todo: 合并文件操作: 校验文件大小,hash,分片
			const resp = await mergeFileService(token);
			ctx.status = 200;
			ctx.body = resp;
		} else {
			await next();
		}
	};
}

export function uploadChunkMiddleWare(storePath: string) {
	return async (ctx: Koa.Context, next: Koa.Next) => {
		if (isUploadChunkRequest(ctx.headers, ctx.path)) {
			const header = ctx.headers as UploadChunkHeader;
			const {
				"upload-hash": hash,
				"upload-token": token,
				"content-length": size,
				"upload-chunk-index": index
			} = header;
			// 保存分片文件, 流式写入chunk, 在文件记录中引用分片地址
			try {
				await uploadChunkService(ctx.req, hash, token, Number(size), Number(index), storePath);
				ctx.status = 200;
				ctx.body = { message: "ok" };
			} catch (err) {
				ctx.status = 500;
				ctx.body = err;
			}
		} else {
			await next();
		}
	};
}

export function downloadFileMiddleWare(storePath: string) {
	return async (ctx: Koa.Context, next: Koa.Next) => {
		if (isDownLoadFileRequest(ctx.path)) {
			const fullPath = ctx.path.replace(/^\/download/, "");
			const index = fullPath.lastIndexOf("/");
			const path = fullPath.substring(0, index);
			const name = fullPath.substring(index + 1, fullPath.length);
			// 从数据库里面查找文件, 和分片记录
			const result = await checkFileService(path, name);
			console.log(result.status);
			if (result.status >= 500) {
				ctx.status = result.status;
				ctx.body = { message: "error" };
			}
			const pass = new PassThrough();
			ctx.set("Content-Disposition", `attachment; filename="${name}"; filename*=UTF-8''${name}`);
			ctx.set("Content-Type", result.type);
			ctx.set("Content-Length", String(result.size));
			ctx.status = result.status;
			ctx.body = pass;
			pass.pipe(ctx.res);
			// 不能阻塞中间件执行
			(async () => {
				for (const chunk of result.chunks) {
					// 流式写入 网络IO
					await pipeChunksStream(chunk, storePath, pass, 0, result.chunkSize - 1);
				}
				pass.end();
			})();
		} else {
			await next();
		}
	};
}

export function deleteFileMiddleWare(storePath: string) {
	return async (ctx: Koa.Context, next: Koa.Next) => {
		if (isDeleteFileRequest(ctx.path)) {
			const fullPath = ctx.path.replace(/^\/delete/, "");
			const index = fullPath.lastIndexOf("/");
			const path = fullPath.substring(0, index);
			const name = fullPath.substring(index + 1, fullPath.length);
			const result = await deleteFileService(path, name, storePath);
			ctx.status = result.status;
			ctx.body = result;
		} else {
			next();
		}
	};
}

export function mediaStreamMiddleWare(storePath: string) {
	return async (ctx: Koa.Context, next: Koa.Next) => {
		if (isMediaStreamRequest(ctx.headers, ctx.path)) {
			const { range } = ctx.headers;
			if (!range) {
				ctx.set("Accept-Ranges", "bytes");
				ctx.status = 500;
				ctx.body = { message: "Range is not defined" };
				return;
			}
			const bytesPrefix = "bytes=";
			if (!range.startsWith(bytesPrefix)) {
				ctx.status = 416;
				ctx.body = { message: "Range Not Satisfiable" };
				return;
			}

			// 解析 Range 请求头
			const rangeValue = range!.substring(bytesPrefix.length);
			const strArr = rangeValue.split("-");
			const startStr = strArr[0]!;
			const endStr = strArr[1]!;

			const fullPath = ctx.path.replace(/^\/media/, "");
			const index = fullPath.lastIndexOf("/");
			const path = fullPath.substring(0, index);
			const name = fullPath.substring(index + 1, fullPath.length);

			// 从数据库里面查找文件, 和分片记录
			const result = await checkFileService(path, name);
			if (result.status >= 500) {
				ctx.status = result.status;
				ctx.body = { message: "File is Error" };
				return;
			}
			// 不是一个 音视频 文件
			const videoRegExp = /^(video|audio)/;
			if (!videoRegExp.test(result.type)) {
				ctx.status = 500;
				ctx.body = { message: "the file is not a media" };
				return;
			}

			const start = parseInt(startStr, 10);
			let end = endStr ? parseInt(endStr, 10) : result.size - 1;

			// 越界处理
			if (start >= result.size) {
				ctx.set("Content-Range", `bytes */${result.size}`);
				ctx.status = 416;
				ctx.body = { message: "range is out" };
				return;
			}

			// 校正 end
			if (end >= result.size - 1) {
				end = result.size - 1;
			}
			// range响应头
			// ctx.res.writeHead(206, {
			// 	"Accept-Ranges": "bytes",
			// 	"Content-Length": `${result.size - start}`,
			// 	"Content-Range": `bytes ${start}-${end}/${result.size}`,
			// 	"Content-Type": result.type,
			// });
			// const pass = new PassThrough();
			// pass.pipe(ctx.res);
			const pass = new PassThrough();
			ctx.status = 206;
			ctx.set("Accept-Ranges", "bytes");
			ctx.set("Content-Length", `${end - start + 1}`);
			ctx.set("Content-Range", `bytes ${start}-${end}/${result.size}`);
			ctx.set("Content-Type", result.type);
			ctx.body = pass;
			// start 文件起始字节  end 文件末尾字节
			const chunks = result.chunks;
			// 69 start 99 end 20 chunk -> 3 9 4 19
			// 0 start 20 chunk -> 0
			const startIndex = Math.floor(start / result.chunkSize);
			const firstReadByte = start % result.chunkSize;
			const endIndex = Math.floor(end / result.chunkSize);
			const endReadByte = end % result.chunkSize;
			(async () => {
				for (let i = startIndex; i <= endIndex; i++) {
					const start = i === startIndex ? firstReadByte : 0;
					const end = i === endIndex ? endReadByte : result.chunkSize - 1;
					await pipeChunksStream(chunks[i]!, storePath, pass, start, end);
				}
				pass.end();
			})();
		} else {
			await next();
		}
	};
}

const STREAM_ERROR_CODE = ["ECONNRESET", "ECANCELED", "ERR_STREAM_PREMATURE_CLOSE", "ECONNABORTED"];

export function MediaStreamErrorHandler() {
	return (err: any) => {
		if (STREAM_ERROR_CODE.includes(err.code)) {
			return;
		}
		console.error(err);
	};
}
