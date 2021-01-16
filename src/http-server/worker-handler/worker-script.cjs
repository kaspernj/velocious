const { workerData, parentPort } = require("worker_threads")
const WorkerThread = require("./worker-thread.cjs")

new WorkerThread({parentPort, workerData})
