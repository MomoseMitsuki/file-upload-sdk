import { prop, getModelForClass, modelOptions, type Ref } from "@typegoose/typegoose";
import mongoose from "mongoose";
import { File } from "./file.js";
@modelOptions({
	schemaOptions: {
		versionKey: false,
		collection: "chunks"
	}
})
export class Chunk {
	@prop({ required: true })
	token!: string;

	@prop({ required: true })
	index!: number;

	@prop({ required: true })
	hash!: string;

	@prop({ required: true })
	size!: number;

	@prop({ default: () => Date.now() })
	createAt!: Date;

	@prop({ ref: "File", type: () => mongoose.Types.ObjectId, default: () => [] })
	files!: Array<Ref<File>>;
}

export const ChunkModel = getModelForClass(Chunk);
