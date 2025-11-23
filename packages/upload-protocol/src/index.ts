export interface CreateFileRequestHeader extends Record<string, string> {
	"upload-file-size": string; // 文件上传大小
	"upload-file-name": string; // 文件名
	"upload-file-mime": string; // 文件MIME类型
}

export interface CreateFileResponse {
	uploadToken: string; // 本次文件上传token (uuid+jwt)
	chunkSize: string; // 本次文件上传分片大小, 为 0 或为空 由客户端决定
}

export interface PatchHashRequestHeader extends Record<string, string> {
	"upload-token": string; // 文件上传token
	"upload-hash-type": "chunk" | "file"; // hash 校验的文件 类型
	"upload-hash": string; // hash
}

export type PatchFileHashResponse =
	| {
			hasFile: true; // 存在文件
			url: string; // 返回 url 访问地址
	  }
	| {
			hasFile: false; // 不存在文件
			token: string; // 返回之前上传的 token
			rest: Array<[number, number]>; // 告诉缺失哪些分片
	  };

export type PatchChunkHashResponse = {
	hasFile: boolean;
};

export type PatchHashResponse<T extends "file" | "chunk"> = T extends "file"
	? PatchFileHashResponse
	: PatchChunkHashResponse;

export interface UploadChunkHeader extends Record<string, string> {
	"upload-token": string; // 文件上传 token
	"upload-chunk-Index": string; // 分片索引
	"upload-hash": string; // 分片 hash
	"content-length": string; // 分片大小
	"content-type": "application/octet-stream";
}

export interface MergeFileRequest extends Record<string, string> {
	"upload-token": string; // 文件上传 token
	"upload-operation": "Merge"; // 合并操作
}

export interface MergeFileResponse {
	url: string; // 合并结果,得到url地址访问资源
}
