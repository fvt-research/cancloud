import { createRequestQueue } from "../requestQueue"

describe("createRequestQueue", () => {
  it("never runs more tasks than the limit at once", async () => {
    const queue = createRequestQueue(2)
    let active = 0
    let peak = 0
    const task = () => {
      active += 1
      peak = Math.max(peak, active)
      return new Promise(resolve =>
        setTimeout(() => {
          active -= 1
          resolve()
        }, 10)
      )
    }
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => queue.add(task)))
    expect(peak).toBe(2)
  })

  it("resolves tasks with their results in enqueue order", async () => {
    const queue = createRequestQueue(1)
    const results = await Promise.all([
      queue.add(() => Promise.resolve("a")),
      queue.add(() => Promise.resolve("b")),
      queue.add(() => "c")
    ])
    expect(results).toEqual(["a", "b", "c"])
  })

  it("rejects with the task error", async () => {
    const queue = createRequestQueue(1)
    await expect(queue.add(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom")
  })

  it("clear() rejects queued tasks that have not started", async () => {
    const queue = createRequestQueue(1)
    let release
    const first = queue.add(() => new Promise(resolve => (release = resolve)))
    const second = queue.add(() => Promise.resolve("never runs"))
    queue.clear()
    await expect(second).rejects.toThrow("cancelled")
    release()
    await first
  })
})
