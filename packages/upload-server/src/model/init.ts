import mongoose from "mongoose";

export async function connectDB(mongodb_url: string, dbName = "fileSystem") {
	try {
		await mongoose.connect(mongodb_url, {
			dbName
		});
		console.log("mongodb connect success!");
	} catch (err) {
		console.log("mongodb connect fail!: ", err);
	}
}
