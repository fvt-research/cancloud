vi.mock("../../web", () => ({
  default: {
  PresignedPutObject: vi.fn(() => Promise.resolve({ url: "http://fake-s3/put" }))
  }
}))
vi.mock("../../buckets/actions", () => ({
  fetchBucketsPostUpload: vi.fn(path => ({ type: "TEST_FETCH_BUCKETS", path }))
}))

import web from "../../web"
import { enqueueUpload, cancelUpload } from "../uploadEngine"

// Minimal scriptable XMLHttpRequest stand-in: each send() consumes the next
// handler from FakeXHR.script, which decides how the attempt ends
class FakeXHR {
  constructor() {
    FakeXHR.instances.push(this)
    this.upload = {
      addEventListener: (event, cb) => {
        if (event === "progress") this.progressCb = cb
      }
    }
  }
  open(method, url) {
    this.method = method
    this.url = url
  }
  send(file) {
    this.file = file
    const handler = FakeXHR.script.shift()
    if (handler) setTimeout(() => handler(this), 0)
  }
  abort() {
    if (this.onabort) this.onabort()
  }
  respond(status) {
    this.status = status
    this.onload()
  }
  progress(loaded) {
    this.progressCb({ lengthComputable: true, loaded })
  }
}

const waitFor = (predicate, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error("waitFor timed out"))
      setTimeout(poll, 10)
    }
    poll()
  })

describe("uploadEngine", () => {
  let actions
  let dispatch
  const realXHR = global.XMLHttpRequest

  const types = () => actions.map(a => a.type)
  const alerts = () => actions.filter(a => a.type === "alert/SET")
  const batchDone = () => alerts().length > 0

  beforeEach(() => {
    actions = []
    // thunk-middleware stand-in: alertActions.set returns a thunk
    dispatch = action => (typeof action === "function" ? action(dispatch) : actions.push(action))
    FakeXHR.instances = []
    FakeXHR.script = []
    global.XMLHttpRequest = FakeXHR
    web.PresignedPutObject.mockClear()
  })

  afterEach(() => {
    global.XMLHttpRequest = realXHR
  })

  it("uploads a file and finishes the batch with one alert and one refetch", async () => {
    FakeXHR.script = [
      xhr => {
        xhr.progress(50)
        xhr.respond(200)
      }
    ]
    enqueueUpload(dispatch, { bucketName: "bucket", prefix: "", file: { name: "AABBCCDD_1_1.MF4", size: 100 } })
    await waitFor(batchDone)

    expect(types()).toEqual([
      "uploads/ADD",
      "uploads/UPDATE_PROGRESS",
      "uploads/STOP",
      "uploads/SHOW_ABORT_MODAL",
      "alert/SET",
      "TEST_FETCH_BUCKETS"
    ])
    expect(alerts()[0].alert.type).toBe("success")
    expect(actions[actions.length - 1].path).toBe("bucket/AABBCCDD")
  })

  it("retries a non-2xx response with a fresh presigned URL", async () => {
    FakeXHR.script = [xhr => xhr.respond(503), xhr => xhr.respond(200)]
    enqueueUpload(dispatch, { bucketName: "bucket", prefix: "", file: { name: "f.json", size: 10 } })
    await waitFor(batchDone)

    expect(web.PresignedPutObject).toHaveBeenCalledTimes(2)
    expect(alerts()[0].alert.type).toBe("success")
  })

  it("settles a permanent 401 failure instead of hanging the modal", async () => {
    FakeXHR.script = [xhr => xhr.respond(401)]
    enqueueUpload(dispatch, { bucketName: "bucket", prefix: "", file: { name: "f.json", size: 10 } })
    await waitFor(batchDone)

    expect(web.PresignedPutObject).toHaveBeenCalledTimes(1)
    expect(types()).toContain("uploads/STOP")
    expect(alerts()[0].alert.type).toBe("danger")
    expect(alerts()[0].alert.message).toContain("none of the 1 file(s)")
  })

  it("gives duplicate filenames distinct slugs", async () => {
    FakeXHR.script = [xhr => xhr.respond(200), xhr => xhr.respond(200)]
    const file = { name: "same.json", size: 10 }
    enqueueUpload(dispatch, { bucketName: "bucket", prefix: "", file })
    enqueueUpload(dispatch, { bucketName: "bucket", prefix: "", file })
    await waitFor(batchDone)

    const adds = actions.filter(a => a.type === "uploads/ADD")
    expect(adds.length).toBe(2)
    expect(adds[0].slug).not.toBe(adds[1].slug)
  })

  it("cancels a queued upload without progress dispatches after cancel", async () => {
    // fill all 3 queue slots with held uploads so the 4th stays queued
    const held = []
    FakeXHR.script = [xhr => held.push(xhr), xhr => held.push(xhr), xhr => held.push(xhr)]
    const slugs = []
    for (let i = 0; i < 3; i++) {
      slugs.push(
        enqueueUpload(dispatch, { bucketName: "bucket", prefix: "", file: { name: `f${i}.json`, size: 10 } })
      )
    }
    const queuedSlug = enqueueUpload(dispatch, {
      bucketName: "bucket",
      prefix: "",
      file: { name: "queued.json", size: 10 }
    })
    await waitFor(() => held.length === 3)

    cancelUpload(queuedSlug)
    held.forEach(xhr => xhr.respond(200))
    await waitFor(batchDone)

    expect(alerts()[0].alert.type).toBe("info")
    expect(alerts()[0].alert.message).toContain("3 file(s) were already uploaded")
    // the aborted-with-successes batch still refreshes the view once
    expect(types().filter(t => t === "TEST_FETCH_BUCKETS").length).toBe(1)
    const progressForQueued = actions.filter(
      a => a.type === "uploads/UPDATE_PROGRESS" && a.slug === queuedSlug
    )
    expect(progressForQueued.length).toBe(0)
  })
})
