import ClientDeliveryQueue from "../src/http-server/client-delivery-queue.js"

const frameBytes = 64 * 1024
const maxBytes = 8 * 1024 * 1024
const maxFrames = 256
const attemptedFrames = 100_000
let acceptedFrames = 0
let overflowCount = 0
let peakBytes = 0
let peakFrames = 0
const blockedWrite = new Promise(() => {})
let queue

queue = new ClientDeliveryQueue({
  clientCount: 1,
  maxBytes,
  maxFrames,
  onOverflow: () => {
    overflowCount += 1
    queue.destroy()
  }
})

for (let index = 0; index < attemptedFrames; index += 1) {
  const before = queue.snapshot()
  const delivery = queue.enqueueFrame({
    byteLength: frameBytes,
    delivery: async () => await blockedWrite
  })

  if (!queue.destroyed) acceptedFrames += 1
  peakBytes = Math.max(peakBytes, before.pendingBytes, queue.snapshot().pendingBytes)
  peakFrames = Math.max(peakFrames, before.pendingFrames, queue.snapshot().pendingFrames)
  void delivery.catch(() => {})
}

if (acceptedFrames !== maxBytes / frameBytes) {
  throw new Error(`Expected ${maxBytes / frameBytes} accepted frames, got ${acceptedFrames}`)
}
if (overflowCount !== 1) throw new Error(`Expected one overflow, got ${overflowCount}`)
if (peakBytes > maxBytes || peakFrames > maxFrames) {
  throw new Error(`Queue exceeded its limits: ${peakFrames} frames / ${peakBytes} bytes`)
}
if (queue.snapshot().pendingBytes !== 0 || queue.snapshot().pendingFrames !== 0) {
  throw new Error("Destroyed queue retained accounting")
}

console.log(JSON.stringify({
  acceptedFrames,
  attemptedFrames,
  maxBytes,
  maxFrames,
  overflowCount,
  peakBytes,
  peakFrames,
  retainedAfterDestroy: queue.snapshot()
}, null, 2))
