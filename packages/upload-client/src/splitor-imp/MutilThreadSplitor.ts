import type { EventEmitter } from "@momosemitsuki/upload-core";
import type { Chunk } from "../chunk";
import { ChunkSplitor } from "../chunkSplitor";

export class MutilThreadSplitor extends ChunkSplitor {
	private workers: Worker[] = [];

	constructor(file: File, chunkSize?: number) {
		super(file, chunkSize);
		this.workers = new Array(navigator.hardwareConcurrency || 4).fill(0).map(
			() =>
				new Worker(new URL("./SplitWorker.esm.js", import.meta.url), {
					type: "module"
				})
		);
	}

	calcHash(chunks: Chunk[], emitter: EventEmitter<"chunks">): void {
		const workerSize = Math.ceil(chunks.length / this.workers.length);
		for (let i = 0; i < this.workers.length; i++) {
			const worker = this.workers[i];
			const start = i * workerSize;
			const end = Math.min((i + 1) * workerSize, chunks.length);
			const workerChunks = chunks.slice(start, end);
			worker!.postMessage(workerChunks);
			worker!.onmessage = e => {
				emitter.emit("chunks", e.data);
			};
		}
	}

	dispose(): void {
		this.workers.forEach(worker => worker.terminate());
	}
}
