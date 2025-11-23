import SparkMD5 from "spark-md5";
import { md5 } from "hash-wasm";

const USE_WASM_SIZE = 1024 * 64;
const USE_WASM = true;

export interface Chunk {
	blob: Blob;
	start: number;
	end: number;
	hash: string;
	index: number;
}

// 创建一个不带hash的chunk
export function createChunk(file: File, index: number, chunkSize: number): Chunk {
	const start = index * chunkSize;
	const end = Math.min((index + 1) * chunkSize, file.size);
	const blob = file.slice(start, end);
	return {
		blob,
		start,
		end,
		hash: "",
		index
	};
}
export function calcChunkHash(chunk: Chunk): Promise<string> {
	if (USE_WASM && chunk.blob.size > USE_WASM_SIZE) {
		return WASMHashStrategy(chunk);
	} else {
		return JSHashStrategy(chunk);
	}
}

function JSHashStrategy(chunk: Chunk): Promise<string> {
	return new Promise(resolve => {
		const spark = new SparkMD5.ArrayBuffer();
		const fileReader = new FileReader();
		fileReader.onload = e => {
			spark.append(e.target?.result as ArrayBuffer);
			resolve(spark.end());
		};
		fileReader.readAsArrayBuffer(chunk.blob);
	});
}

function WASMHashStrategy(chunk: Chunk): Promise<string> {
	return new Promise(resolve => {
		const fileReader = new FileReader();
		fileReader.onload = async e => {
			const buffer = e.target?.result as any;
			const data = new Uint8Array(buffer);
			const hash = await md5(data);
			resolve(hash);
		};
		fileReader.readAsArrayBuffer(chunk.blob);
	});
}
