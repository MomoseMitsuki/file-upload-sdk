import type { Request, Response, NextFunction } from "express";
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
	signFileToken,
	createFileService,
	patchFileHashService,
	mergeFileService,
	checkFileService,
	pipeChunksStream,
	deleteFileService
} from "../services/fileService.js";
import { patchChunkHashService, uploadChunkService } from "../services/chunkService.js";
import { PassThrough } from "node:stream";

const CHUNK_SIZE = 1024 * 1024 * 5;

export function createFileMiddleWare(chunkSize: number = CHUNK_SIZE) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (isCreateFileRequest(req.headers, req.path)) {
			const header = req.headers as CreateFileRequestHeader;
			const token = signFileToken(header);
			// todo: 创建文件
			const path = req.path.replace(/^\/upload/, "");
			// 上传地址 /upload/资料/web前端   ->    /资料/web前端
			const { "upload-file-size": size, "upload-file-name": name, "upload-file-mime": type } = header;
			const resp = await createFileService(path, name, type, "undefined", token, Number(size), chunkSize);
			res.send(resp);
		} else {
			next();
		}
	};
}

export function patchHashMiddleWare() {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (isPatchHashRequest(req.headers, req.path)) {
			const header = req.headers as PatchHashRequestHeader;
			const { "upload-hash-type": type, "upload-hash": hash, "upload-token": token } = header;
			// todo: 比对数据库中的hash
			if (type === "chunk") {
				// 比对 chunk hash
				const resp = await patchChunkHashService(hash);
				res.send(resp);
			} else {
				// 比对 file hash
				const resp = await patchFileHashService(token, hash);
				res.send(resp);
			}
		} else {
			next();
		}
	};
}

export function mergeFileMiddleWare() {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (isMergeFileRequest(req.headers, req.path)) {
			const header = req.headers as MergeFileRequestHeader;
			const { "upload-token": token } = header;
			// todo: 合并文件操作: 校验文件大小,hash,分片
			mergeFileService(token).then(resp => {
				res.send(resp);
			});
		} else {
			next();
		}
	};
}

export function uploadChunkMiddleWare(storePath: string) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (isUploadChunkRequest(req.headers, req.path)) {
			const header = req.headers as UploadChunkHeader;
			const {
				"upload-hash": hash,
				"upload-token": token,
				"content-length": size,
				"upload-chunk-index": index
			} = header;
			// 保存分片文件, 流式写入chunk, 在文件记录中引用分片地址
			uploadChunkService(req, hash, token, Number(size), Number(index), storePath).then(
				() => {
					res.status(200).send();
				},
				err => res.status(500).send(err)
			);
		} else {
			next();
		}
	};
}

export function downloadFileMiddleWare(storePath: string) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (isDownLoadFileRequest(req.path)) {
			const fullPath = req.path.replace(/^\/download/, "");
			const index = fullPath.lastIndexOf("/");
			const path = fullPath.substring(0, index);
			const name = fullPath.substring(index + 1, fullPath.length);
			// 从数据库里面查找文件, 和分片记录
			const result = await checkFileService(path, name);
			if (result.status >= 500) {
				res.status(result.status).send();
			}
			const pass = new PassThrough();
			res.setHeader("Content-Disposition", `attachment; filename="${name}"; filename*=UTF-8''${name}`);
			res.setHeader("Content-Type", result.type);
			res.setHeader("Content-Length", result.size);
			pass.pipe(res);
			for (const chunk of result.chunks) {
				// 流式写入 网络IO
				await pipeChunksStream(chunk, storePath, pass, 0, result.chunkSize - 1);
			}
			pass.end();
		} else {
			next();
		}
	};
}

export function deleteFileMiddleWare(storePath: string) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (isDeleteFileRequest(req.path)) {
			const fullPath = req.path.replace(/^\/delete/, "");
			const index = fullPath.lastIndexOf("/");
			const path = fullPath.substring(0, index);
			const name = fullPath.substring(index + 1, fullPath.length);
			const result = await deleteFileService(path, name, storePath);
			await res.status(result.status).send(result);
		} else {
			next();
		}
	};
}

export function mediaStreamMiddleWare(storePath: string) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (isMediaStreamRequest(req.headers, req.path)) {
			const { range } = req.headers;
			if (!range) {
				res.setHeader("Accept-Ranges", "bytes");
				res.status(500).send({ message: "Range is not defined" });
				return;
			}
			const bytesPrefix = "bytes=";
			if (!range.startsWith(bytesPrefix)) {
				res.status(416).send({ message: "Range Not Satisfiable" });
				return;
			}

			// 解析 Range 请求头
			const rangeValue = range!.substring(bytesPrefix.length);
			const strArr = rangeValue.split("-");
			const startStr = strArr[0]!;
			const endStr = strArr[1]!;

			const fullPath = req.path.replace(/^\/media/, "");
			const index = fullPath.lastIndexOf("/");
			const path = fullPath.substring(0, index);
			const name = fullPath.substring(index + 1, fullPath.length);

			// 从数据库里面查找文件, 和分片记录
			const result = await checkFileService(path, name);
			if (result.status >= 500) {
				res.status(result.status).send("File is Error");
				return;
			}

			// 不是一个 音视频 文件
			const videoRegExp = /^(video|audio)/;
			if (!videoRegExp.test(result.type)) {
				res.status(500).send({ message: "the file is not a media" });
			}

			const start = parseInt(startStr, 10);
			let end = endStr ? parseInt(endStr, 10) : result.size - 1;

			// 越界处理
			if (start >= result.size) {
				res.setHeader("Content-Range", `bytes */${result.size}`);
				res.status(416).send({ message: "range is out" });
				return;
			}

			// 校正 end
			if (end >= result.size - 1) {
				end = result.size - 1;
			}
			// range响应头
			res.setHeader("Accept-Ranges", "bytes");
			res.setHeader("Content-Length", `${result.size - start}`);
			res.setHeader("Content-Range", `bytes ${start}-${end}/${result.size}`);
			res.setHeader("Content-Type", result.type);
			res.status(206);
			const pass = new PassThrough();

			pass.pipe(res);
			// start 文件起始字节  end 文件末尾字节
			const chunks = result.chunks;
			// 69 start 99 end 20 chunk -> 3 9 4 19
			// 0 start 20 chunk -> 0
			const startIndex = Math.floor(start / result.chunkSize);
			const firstReadByte = start % result.chunkSize;
			const endIndex = Math.floor(end / result.chunkSize);
			const endReadByte = end % result.chunkSize;
			for (let i = startIndex; i <= endIndex; i++) {
				const start = i === startIndex ? firstReadByte : 0;
				const end = i === endIndex ? endReadByte : result.chunkSize - 1;
				await pipeChunksStream(chunks[i]!, storePath, pass, start, end);
			}
			pass.end();
		} else {
			next();
		}
	};
}
