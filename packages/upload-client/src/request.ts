import { TaskQueue, Task, EventEmitter } from "@momosemitsuki/upload-core";
import type { Chunk } from "./chunk";
import type { ChunkSplitor } from "./chunkSplitor";
import { MutilThreadSplitor } from "./splitor-imp/MutilThreadSplitor";

type UploadChunkEvent = "end";

import type {
	CreateFileRequestHeader,
	CreateFileResponse,
	MergeFileRequest,
	MergeFileResponse,
	PatchHashResponse,
	PatchHashRequestHeader
} from "@momosemitsuki/upload-protocol";

export interface RequestStrategy {
	url: string;
	// 文件创建请求, 返回token
	createFile(file: File): Promise<CreateFileResponse>;
	// 分片上传请求
	uploadChunk(chunk: Chunk, token: string, UploadChunkEvent: EventEmitter<UploadChunkEvent>): Promise<void>;
	// 文件合并请求
	mergeFile(token: string): Promise<MergeFileResponse>;
	// hash校验请求
	patchHash<T extends "file" | "chunk">(token: string, hash: string, type: T): Promise<PatchHashResponse<T>>;
}

export class FetchRequestStrategy implements RequestStrategy {
	url: string;
	constructor(url: string) {
		this.url = url;
	}
	async createFile(file: File): Promise<CreateFileResponse> {
		const headers: CreateFileRequestHeader = {
			"upload-file-size": String(file.size),
			"upload-file-name": encodeURIComponent(file.name),
			"upload-file-mime": file.type
		};
		const resp = await fetch(this.url, { headers });
		const result = (await resp.json()) as CreateFileResponse;
		return result;
	}

	async uploadChunk(chunk: Chunk, token: string, uploadEmitter: EventEmitter<UploadChunkEvent>): Promise<void> {
		const header = {
			"upload-token": token,
			"upload-chunk-index": String(chunk.index),
			"upload-hash": chunk.hash,
			"content-type": "application/octet-stream"
		};
		await fetch(this.url, {
			method: "post",
			headers: header,
			body: chunk.blob
		});
		uploadEmitter.emit("end");
		return;
	}

	async mergeFile(token: string): Promise<MergeFileResponse> {
		const headers: MergeFileRequest = {
			"upload-token": token,
			"upload-operation": "Merge"
		};
		const resp = await fetch(this.url, { headers });
		const result = (await resp.json()) as MergeFileResponse;
		return result;
	}

	async patchHash<T extends "file" | "chunk">(token: string, hash: string, type: T): Promise<PatchHashResponse<T>> {
		const headers: PatchHashRequestHeader = {
			"upload-token": token,
			"upload-hash-type": type,
			"upload-hash": hash
		};
		const resp = await fetch(this.url, {
			headers
		});
		const result = (await resp.json()) as PatchHashResponse<T>;
		return result;
	}
}

export class UploadController extends EventEmitter<"start" | "end"> {
	private requestStrategy!: RequestStrategy;
	private splitStrategy!: ChunkSplitor;
	private taskQueue: TaskQueue;
	private token: string = "";
	private file: File;
	private url: string;
	private _ChunksCount = 0;
	private _fulfillCount = 0;
	private uploadEmitter: EventEmitter<UploadChunkEvent> = new EventEmitter();
	// 只读属性
	public get fulfillCount() {
		// 已完成上传的分片
		return this._fulfillCount;
	}
	public get ChunksCount() {
		// 需要上传的总分片
		return this._ChunksCount;
	}
	/**
	 * 	@param url 文件上传的url接口地址
	 *  @param file 所上传的文件
	 *  @param concurrency 请求并发数
	 */
	constructor(url: string, file: File, concurrency: number = 6) {
		super();
		this.file = file;
		this.url = url;
		this.taskQueue = new TaskQueue(concurrency);
	}
	/**
	 * @param RequestStrategy 请求策略
	 * @param splitStrategy 分片策略
	 */
	async init(
		RequestStrategy: new (url: string) => RequestStrategy = FetchRequestStrategy,
		splitStrategy: new (file: File, chunkSize?: number) => ChunkSplitor = MutilThreadSplitor
	) {
		this.emit("start");
		this.requestStrategy = new RequestStrategy(this.url);
		// 文件创建请求, 返回token
		const { uploadToken, chunkSize } = await this.requestStrategy.createFile(this.file);
		this.splitStrategy = new splitStrategy(this.file, chunkSize ? Number(chunkSize) : undefined);
		this._ChunksCount = this.splitStrategy.chunks.length;
		this.token = uploadToken;
		this.uploadEmitter.on("end", () => {
			// 记录当前已上传完毕的分片
			this._fulfillCount++;
			// 上传完毕,进行合并,同时抛出 end 事件钩子, 可在 UploadController 的实例上通过 on 方法拿到 url 地址
			if (this.fulfillCount === this.splitStrategy!.chunks.length) {
				this.requestStrategy.mergeFile(this.token).then(resp => {
					this.emit("end", resp.url);
				});
			}
		});
		// 分片事件监听
		this.splitStrategy!.on("chunks", this.handleChunks.bind(this));
		this.splitStrategy!.on("wholeHash", this.handleWholeHash.bind(this));
		this.splitStrategy.split();
	}

	// 分片事件处理
	private handleChunks(chunks: Chunk[]) {
		// 分片上传任务加入队列
		chunks.forEach(chunk => {
			this.taskQueue.addAndStart(new Task(this.uploadChunk.bind(this), chunk));
		});
	}

	async uploadChunk(chunk: Chunk) {
		// hash校验
		const resp = await this.requestStrategy.patchHash(this.token, chunk.hash, "chunk");
		if (resp.hasFile) {
			// 文件已存在
			this.uploadEmitter.emit("end");
			return;
		}
		// 分片上传   uploadEmitter 用于在上传分片过程中抛出事件执行
		await this.requestStrategy.uploadChunk(chunk, this.token, this.uploadEmitter);
	}

	// 整体hash事件处理
	private async handleWholeHash(hash: string) {
		// hash校验
		const resp = await this.requestStrategy.patchHash(this.token, hash, "file");
		if (resp.hasFile) {
			// 文件已存在
			this.emit("end", resp.url);
			return;
		} else {
			// 根据resp.rest重新编排后续任务
			this.taskQueue.clear();
			this.token = resp.token;
			const restChunks: Chunk[] = [];
			const allChunks = this.splitStrategy!.chunks;
			// 获取 rest 剩余分片
			resp.rest.forEach(limit => {
				restChunks.concat(allChunks.slice(limit[0], limit[1]));
			});
			this._fulfillCount = this.ChunksCount - restChunks.length;
			this.handleChunks(restChunks);
		}
	}
}
