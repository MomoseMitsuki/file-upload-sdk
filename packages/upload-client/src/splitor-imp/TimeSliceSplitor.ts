import type { EventEmitter } from "@momosemitsuki/upload-core";
import { calcChunkHash, type Chunk } from "../chunk";
import { ChunkSplitor } from "../chunkSplitor";

export class TimeSliceSplitor extends ChunkSplitor {
	private isCanceled = false;
	private deadline = 10;
	constructor(file: File, chunkSize?: number) {
		super(file, chunkSize);
	}

	calcHash(chunks: Chunk[], emitter: EventEmitter<"chunks">): void {
		let currentIndex = 0;
		const calcFiberHash = () => {
			if (this.isCanceled) return;
			const startTime = performance.now();
			const calcNextChunk = () => {
				const chunk = chunks[currentIndex] as Chunk;
				currentIndex++;
				calcChunkHash(chunk).then(hash => {
					chunk.hash = hash;
					emitter.emit("chunks", [chunk]);
					if (performance.now() - startTime >= this.deadline) {
						return requestIdleCallback(calcFiberHash);
					} else {
						calcNextChunk();
					}
				});
			};
			calcNextChunk();
		};
		requestIdleCallback(calcFiberHash);
	}

	dispose(): void {
		this.isCanceled = true;
	}
}
