import {workerData, parentPort} from "worker_threads"
import WorkerThread from "./worker-thread.mjs"

new WorkerThread({parentPort, workerData})
