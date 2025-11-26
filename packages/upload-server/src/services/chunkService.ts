import fs from "fs";
import path from "path";
import type { Readable } from "stream";
import { FileModel } from "../model/file.js";
import { ChunkModel, Chunk } from "../model/chunk.js";

export async function patchChunkHashService(hash: string) {
	const chunk: Chunk | null = await ChunkModel.findOne({ hash });
	return chunk ? { hasFile: true } : { hasFile: false };
}

export function uploadChunkService(
	rs: Readable,
	hash: string,
	token: string,
	size: number,
	index: number,
	storePath: string
): Promise<void> {
	return new Promise(async (resolve, reject) => {
		const { hasFile } = await patchChunkHashService(hash);
		if (hasFile) {
			return resolve();
		}
		// 没有目录创建目录
		if (!fs.existsSync(storePath)) {
			await fs.promises.mkdir(storePath);
		}
		// chunk 命名规则 [hash].chunk
		const chunkStorePath = path.resolve(storePath, `${hash}.chunk`);
		const ws = fs.createWriteStream(chunkStorePath);
		// pipe 管道建立流式写入
		rs.pipe(ws);
		ws.on("finish", () => {
			console.log("流式写入完成!");
			recordChunkService(hash, token, size, index).then(() => resolve());
		});
		ws.on("error", reject);
		rs.on("error", reject);
	});
}

async function recordChunkService(hash: string, token: string, size: number, index: number) {
	// todo: 数据库记录 chunk 信息, 根据 token 引用到 file 上
	// chunk: hash token size index
	const chunk = await ChunkModel.create({
		hash,
		token,
		size,
		index
	});
	const file = await FileModel.findOne({ token }).populate("chunks");
	file!.chunks[index] = chunk._id;
	await file!.save();
	return;
}
