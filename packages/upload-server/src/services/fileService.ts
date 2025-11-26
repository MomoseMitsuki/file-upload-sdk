import SparkMD5 from "spark-md5";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { v4 } from "uuid";
import { Types } from "mongoose";
import type { DocumentType } from "@typegoose/typegoose";
import type { Duplex } from "stream";
import type { CreateFileRequestHeader, PatchFileHashResponse } from "@momosemitsuki/upload-protocol";
import { File, FileModel } from "../model/file.js";
import { Chunk, ChunkModel } from "../model/chunk.js";

interface DownLoadFileResp {
	status: number;
	chunks: Array<Chunk>;
	type: string;
	size: number;
	chunkSize: number;
}

export function signFileToken(options: CreateFileRequestHeader, JWT_SECRET = "mitsuki") {
	const uuid = v4();
	const { "upload-file-name": name, "upload-file-mime": type, "upload-file-size": size } = options;
	const payload = {
		uuid,
		name,
		type,
		size
	};
	const token = jwt.sign(payload, JWT_SECRET, {
		algorithm: "HS256"
	});
	return token;
}

export async function createFileService(
	path: string,
	name: string,
	type: string,
	hash: string,
	token: string,
	size: number,
	chunkSize: number
) {
	const lastFile = await FileModel.findOne({ path, name });
	if (lastFile) {
		return {
			uploadToken: lastFile.token,
			chunkSize: lastFile.chunkSize
		};
	}
	const ChunkCounts = Math.ceil(size / chunkSize); // 分片总数
	await FileModel.create({
		path,
		name,
		type,
		hash,
		token,
		size,
		chunkSize,
		chunks: new Array(ChunkCounts).fill(new Types.ObjectId("000000000000000000000000"))
	});
	return {
		uploadToken: token,
		chunkSize
	};
}

export async function patchFileHashService(token: string, hash: string): Promise<PatchFileHashResponse> {
	// 之前可能已经上传过的 文件
	const file: File | null = await FileModel.findOne({ hash }).populate("chunks");
	// 当前上传的文件
	const curFile: File | null = await FileModel.findOne({ token }).populate("chunks");
	if (file && file.status === "fulfilled") {
		// 有文件记录, 之前上传过, 分片也齐了
		return {
			hasFile: true,
			url: `/download/${file!.path}/${file!.name}`
		};
	} else if (file && file.status === "pending") {
		// 有文件记录, 之前上传过, 分片不齐
		await FileModel.deleteOne({ token });
		const totalCount = Math.ceil(file.size / file.chunkSize);
		const rest = calcRestChunks(file.chunks as Array<Chunk>, totalCount);
		return {
			hasFile: false,
			token: file.token,
			rest
		};
	} else {
		// 没有文件记录, 更新本次文件记录hash
		await FileModel.updateOne({ token }, { hash });
		const totalCount = Math.ceil(curFile!.size / curFile!.chunkSize);
		const rest = calcRestChunks(curFile!.chunks as Array<Chunk>, totalCount);
		return {
			hasFile: false,
			rest,
			token
		};
	}
}

export async function mergeFileService(token: string) {
	// 进行分片合并
	// 我们不进行真正的合并, 仅校验文件大小,hash,分片是否正确
	const file = await FileModel.findOne({ token }).populate("chunks");
	const chunks = file!.chunks as Array<DocumentType<Chunk>>;
	const totalCount = Math.ceil(file!.size / file!.chunkSize);
	const rest = calcRestChunks(chunks, totalCount);
	// 分片不齐
	if (rest.length !== 0) {
		return { status: 500, message: "some chunks has lost" };
	}
	let totalChunkSize = 0;
	const spark = new SparkMD5();
	chunks.forEach(chunk => {
		if (chunk) {
			totalChunkSize += chunk.size;
			spark.append(chunk.hash);
		}
	});
	const hash = spark.end();
	// 文件大小不对
	if (totalChunkSize !== file!.size) {
		console.log("文件大小不对");
		return { status: 500, message: "file size is wrong" };
	}
	// 文件hash不对
	if (hash !== file!.hash) {
		return { status: 500, message: "chunks hash is not same with file" };
	}
	// todo: 取出 分片 记录文件引用
	const chunkIds = chunks.map(c => c._id);
	await ChunkModel.updateMany({ _id: { $in: chunkIds } }, { $addToSet: { files: file!._id } });

	// 更新文件状态为 完成
	await FileModel.updateOne({ token }, { status: "fulfilled" });
	return { url: `${file!.path}/${file!.name}` };
}

export async function checkFileService(path: string, name: string): Promise<DownLoadFileResp> {
	const file = await FileModel.findOne({ path, name }).populate("chunks");
	const resp: DownLoadFileResp = {
		status: 200,
		chunks: [],
		type: file?.type || "application/octet-stream",
		size: file?.size || 0,
		chunkSize: file?.chunkSize || 0
	};
	if (!file || file.status !== "fulfilled") {
		console.log("文件状态不对");
		resp.status = 500;
		return resp;
	}
	const chunks = file!.chunks as Array<Chunk>;
	const totalCount = Math.ceil(file.size / file.chunkSize);
	const rest = calcRestChunks(chunks, totalCount);
	if (rest.length !== 0) {
		console.log("分片不齐", rest);
		resp.status = 500;
		return resp;
	}
	resp.chunks = chunks;
	return resp;
}

export async function deleteFileService(filePath: string, name: string, storePath: string) {
	const file = await FileModel.findOne({ path: filePath, name }).populate("chunks");
	if (!file) {
		return {
			status: 404,
			message: "File Not Found"
		};
	}
	const chunks = file.chunks as Array<DocumentType<Chunk>>;
	// 清理分片引用
	for (const chunk of chunks) {
		if (chunk.files.includes(file._id)) {
			const index = chunk.files.indexOf(file._id);
			chunk.files.splice(index, 1);
			await chunk.save();
			// 该分片没有被文件引用了, 可以删除了
			if (chunk.files.length === 0) {
				const chunkPath = path.resolve(storePath, `${chunk.hash}.chunk`);
				await fs.promises.rm(chunkPath, { force: true });
				await ChunkModel.deleteOne({ _id: chunk._id });
			}
		}
	}
	// 清理文件记录
	await FileModel.deleteOne({ _id: file._id });
	return {
		status: 200,
		message: "delete file successfully"
	};
}

export function pipeChunksStream(
	chunk: Chunk,
	storePath: string,
	pass: Duplex,
	start: number,
	end: number
): Promise<void> {
	return new Promise((resolve, reject) => {
		const chunkPath = path.resolve(storePath, `${chunk.hash}.chunk`);
		const rs = fs.createReadStream(chunkPath, {
			start,
			end
		});
		rs.on("end", resolve);
		rs.on("error", reject);
		rs.pipe(pass, { end: false });
	});
}

function calcRestChunks(chunks: Array<Chunk>, total: number): Array<[number, number]> {
	if (chunks.length === total) {
		return [];
	}
	let indexArr: number[] = [];
	const result: Array<[number, number]> = [];
	for (const chunk of chunks) {
		indexArr.push(Number(chunk.index));
	}
	indexArr = indexArr.sort((left: number, right: number) => Number(left < right));
	// 起始从 0 开始
	let prev = -1;
	for (let i = 0; i <= indexArr.length; i++) {
		// 当前值：数组末尾后补 total 作为边界
		const curr = i < indexArr.length ? indexArr[i]! : total;
		// 如果中间缺少区间
		if (curr - prev > 1) {
			const start = prev + 1;
			const end = curr - 1;
			result.push([start, end]);
		}
		prev = curr;
	}
	return result;
}
