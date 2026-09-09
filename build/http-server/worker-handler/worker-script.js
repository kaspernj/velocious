// @ts-check

import {workerData, parentPort} from "worker_threads"
import WorkerThread from "./worker-thread.js"

new WorkerThread({parentPort, workerData})
