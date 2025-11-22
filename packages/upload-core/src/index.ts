export class EventEmitter<T extends string> {
	private events: Map<T, Set<Function>>;

	constructor() {
		this.events = new Map();
	}

	on(event: T, listener: Function) {
		if (!this.events.has(event)) {
			this.events.set(event, new Set());
		}
		this.events.get(event)!.add(listener);
	}

	emit(event: T, ...args: any[]) {
		if (!this.events.has(event)) {
			return;
		}
		this.events.get(event)!.forEach(listener => {
			listener(...args);
		});
	}

	off(event: T, listener: Function) {
		if (!this.events.has(event)) {
			return;
		}
		this.events.get(event)!.delete(listener);
	}

	once(event: T, listener: Function) {
		const onceListener = (...args: any[]) => {
			listener(...args);
			this.off(event, onceListener);
		};
		this.on(event, onceListener);
	}
}

export class Task {
	fn: Function;
	payload?: any;
	constructor(fn: Function, payload?: any) {
		this.fn = fn;
		this.payload = payload;
	}
	run() {
		return this.fn(this.payload);
	}
}

export class TaskQueue extends EventEmitter<"start" | "pause" | "drain"> {
	private tasks: Set<Task> = new Set();
	private currentCount = 0;
	private status: "paused" | "running" = "paused";
	private concurrency: number = 4;

	constructor(concurrency: number) {
		super();
		this.concurrency = concurrency;
	}

	add(...tasks: Task[]) {
		for (const t of tasks) {
			this.tasks.add(t);
		}
	}

	addAndStart(...tasks: Task[]) {
		this.add(...tasks);
		this.start();
	}

	start() {
		if (this.status === "running") {
			return;
		}
		if (this.tasks.size === 0) {
			this.emit("drain");
			return;
		}
		this.status = "running";
		this.runNext();
		this.emit("start");
	}

	private takeHeadTask() {
		const task = this.tasks.values().next().value;
		if (task) {
			this.tasks.delete(task);
		}
		return task;
	}

	private runNext() {
		if (this.status !== "running") {
			return;
		}
		if (this.concurrency <= this.currentCount) {
			return;
		}
		const task = this.takeHeadTask();
		if (!task) {
			this.status = "paused";
			this.emit("drain");
			return;
		}
		this.currentCount++;
		Promise.resolve(task.run()).finally(() => {
			this.currentCount--;
			console.log("执行下一个任务");
			this.runNext();
		});
		this.runNext();
	}

	pause() {
		this.status = "paused";
		this.emit("pause");
	}

	clear() {
		this.tasks.clear();
	}
}
