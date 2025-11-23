import type { EventEmitter } from "@momosemitsuki/upload-core";
import { calcChunkHash, type Chunk } from "../chunk";
import { ChunkSplitor } from "../chunkSplitor";

export class DefaultChunkSplitor extends ChunkSplitor {
	constructor(file: File, chunkSize?: number) {
		super(file, chunkSize);
	}
	calcHash(chunks: Chunk[], emitter: EventEmitter<"chunks">): void {
		for (const chunk of chunks) {
			calcChunkHash(chunk).then(hash => {
				chunk.hash = hash;
				emitter.emit("chunks", [chunk]);
			});
		}
	}
	dispose(): void {}
}
