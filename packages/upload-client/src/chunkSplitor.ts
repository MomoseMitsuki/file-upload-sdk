import SparkMD5 from "spark-md5";
import { EventEmitter } from "@momosemitsuki/upload-core";
import { createChunk, type Chunk } from "./chunk";

export type ChunkSplitorEvents = "chunks" | "wholeHash" | "drain";

export abstract class ChunkSplitor extends EventEmitter<ChunkSplitorEvents> {
	protected chunkSize: number;
	protected file: File;
	protected hash?: string;
	private handleChunkCount = 0;
	private spark = new SparkMD5();
	private hasSplited = false;
	// 在 UploadController 内暴露出 chunks,以便获取剩余chunks
	public chunks: Chunk[];
	constructor(file: File, chunkSize = 1024 * 1024 * 5) {
		super();
		this.chunkSize = chunkSize;
		this.file = file;
		this.on("drain", this.dispose.bind(this));
		const chunkCount = Math.ceil(this.file.size / this.chunkSize);
		this.chunks = new Array(chunkCount).fill(0).map((_, index) => createChunk(this.file, index, this.chunkSize));
	}

	split() {
		if (this.hasSplited) {
			return;
		}
		this.hasSplited = true;
		const emitter = new EventEmitter<"chunks">();
		const chunkHandler = (chunks: Chunk[]) => {
			// 获取已完成hash的分片,交由上层 UploadController 上传
			this.emit("chunks", chunks);
			// 多线程的 MessageChannel 对对象进行了序列化和反序列化,深拷贝了一个对象,拿到的chunk不是this.chunks里面的chunk
			for (const chunk of chunks) {
				this.chunks[chunk.index]!.hash = chunk.hash;
			}
			this.handleChunkCount += chunks.length;
			// 所有分片hash计算完成,获取总hash为文件hash
			if (this.handleChunkCount === this.chunks.length) {
				// 不能在前面去计算hash,因为多线程可能没有按照顺序来返回分片
				this.chunks.forEach(chunk => {
					this.spark.append(chunk.hash);
				});
				emitter.off("chunks", chunkHandler);
				// 在 UploadController 内完成总文件hash校验
				const result = this.spark.end();
				this.emit("wholeHash", result);
				this.spark.destroy();
				this.emit("drain");
			}
		};
		emitter.on("chunks", chunkHandler);
		this.calcHash(this.chunks, emitter);
	}

	abstract calcHash(chunks: Chunk[], emitter: EventEmitter<"chunks">): void;

	abstract dispose(): void;
}
