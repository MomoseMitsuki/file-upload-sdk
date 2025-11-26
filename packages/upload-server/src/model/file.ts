import { prop, getModelForClass, modelOptions, type Ref } from "@typegoose/typegoose";
import { Chunk } from "./chunk.js";
import mongoose from "mongoose";

@modelOptions({
	schemaOptions: {
		versionKey: false,
		collection: "files"
	}
})
export class File {
	@prop({ required: true })
	token!: string;

	@prop({ required: true })
	name!: string;

	@prop({ required: true })
	type!: string;

	@prop({ required: true })
	hash!: string;

	@prop({ required: true })
	path!: string;

	@prop({ required: true })
	size!: number;

	@prop({ require: true })
	chunkSize!: number;

	@prop({ default: () => "pending" })
	status!: "pending" | "fulfilled";

	@prop({ default: () => Date.now() })
	createAt!: Date;

	@prop({ ref: () => Chunk, type: () => mongoose.Types.ObjectId, default: () => [] })
	chunks!: Array<Ref<Chunk>>;
}

export const FileModel = getModelForClass(File);
