import reducer from "../reducer";
import * as actions from "../actionTypes";

// Focused coverage for the run-summary accounting, especially the retry path
// (RUN_APPEND) which must preserve the already-submitted rows and the
// cumulative finished/failed counters instead of resetting them.

const init = () => reducer(undefined, { type: "@@INIT" });

const apply = (state, actionsList) =>
  actionsList.reduce((acc, action) => reducer(acc, action), state);

const status = (deviceId, state, message) => ({
  type: actions.RUN_DEVICE_STATUS,
  deviceId,
  state,
  message
});

describe("otaBatch reducer - run accounting", () => {
  it("RUN_START seeds queued rows and zero counters", () => {
    const s = apply(init(), [
      { type: actions.RUN_START, deviceIds: ["A", "B", "C"] }
    ]);
    expect(s.run.active).toBe(true);
    expect(s.run.total).toBe(3);
    expect(s.run.finished).toBe(0);
    expect(s.run.failed).toBe(0);
    expect(s.run.deviceStatus.A).toEqual({ state: "queued" });
  });

  it("counts finished/failed as devices reach terminal states", () => {
    const s = apply(init(), [
      { type: actions.RUN_START, deviceIds: ["A", "B", "C", "D", "E"] },
      status("A", "submitting"),
      status("A", "submitted"),
      status("B", "submitted"),
      status("C", "submitted"),
      status("D", "error", "boom"),
      status("E", "error", "boom"),
      { type: actions.RUN_DONE }
    ]);
    expect(s.run.active).toBe(false);
    expect(s.run.finished).toBe(5);
    expect(s.run.failed).toBe(2);
  });

  it("RUN_APPEND re-queues failed devices without losing the submitted rows or the cumulative summary", () => {
    // first run: A,B,C submitted; D,E failed
    let s = apply(init(), [
      { type: actions.RUN_START, deviceIds: ["A", "B", "C", "D", "E"] },
      status("A", "submitted"),
      status("B", "submitted"),
      status("C", "submitted"),
      status("D", "error", "boom"),
      status("E", "error", "boom"),
      { type: actions.RUN_DONE }
    ]);
    expect(s.run.finished).toBe(5);
    expect(s.run.failed).toBe(2);

    // retry: E converged to "unchanged" (dispatched submitted directly), D re-queued
    s = apply(s, [
      status("E", "submitted", "No changes (already applied)"),
      { type: actions.RUN_APPEND, deviceIds: ["D"] }
    ]);
    // E moved out of failed; D un-counted and re-queued; total unchanged
    expect(s.run.active).toBe(true);
    expect(s.run.total).toBe(5);
    expect(s.run.failed).toBe(0);
    expect(s.run.finished).toBe(4);
    expect(s.run.deviceStatus.D).toEqual({ state: "queued" });
    // the originally submitted rows are untouched
    expect(s.run.deviceStatus.A).toEqual({ state: "submitted", message: undefined });

    // D now submits successfully
    s = apply(s, [
      status("D", "submitting"),
      status("D", "submitted"),
      { type: actions.RUN_DONE }
    ]);
    expect(s.run.finished).toBe(5);
    expect(s.run.failed).toBe(0);
    // footer math: submitted = finished - failed = 5
    expect(s.run.finished - s.run.failed).toBe(5);
  });

  it("RUN_APPEND then re-fail restores the original failed count (no double counting)", () => {
    let s = apply(init(), [
      { type: actions.RUN_START, deviceIds: ["A", "B", "C", "D", "E"] },
      status("A", "submitted"),
      status("B", "submitted"),
      status("C", "submitted"),
      status("D", "error", "boom"),
      status("E", "error", "boom"),
      { type: actions.RUN_DONE }
    ]);

    // retry both, both fail again
    s = apply(s, [
      { type: actions.RUN_APPEND, deviceIds: ["D", "E"] },
      status("D", "submitting"),
      status("D", "error", "boom again"),
      status("E", "submitting"),
      status("E", "error", "boom again"),
      { type: actions.RUN_DONE }
    ]);

    expect(s.run.total).toBe(5);
    expect(s.run.finished).toBe(5);
    expect(s.run.failed).toBe(2);
    expect(s.run.finished - s.run.failed).toBe(3); // 3 submitted
  });
});

describe("otaBatch reducer - encrypt toggle & selection prune", () => {
  it("SET_ENCRYPT_PASSWORDS toggles the flag without touching selection", () => {
    let s = apply(init(), [
      { type: actions.SET_SELECTION, selected: { A: true } },
      { type: actions.SET_ENCRYPT_PASSWORDS, value: true }
    ]);
    expect(s.encryptPasswords).toBe(true);
    expect(s.selected).toEqual({ A: true });
    s = reducer(s, { type: actions.SET_ENCRYPT_PASSWORDS, value: false });
    expect(s.encryptPasswords).toBe(false);
  });

  it("SET_EVALUATIONS prunes the selection to eligible devices", () => {
    const s = apply(init(), [
      { type: actions.SET_SELECTION, selected: { A: true, B: true, C: true } },
      {
        type: actions.SET_EVALUATIONS,
        token: 0,
        evaluations: {
          A: { status: "eligible", eligible: true },
          B: { status: "eligible", eligible: false },
          C: { status: "blocked", eligible: false }
        }
      }
    ]);
    expect(s.selected).toEqual({ A: true });
  });
});

describe("otaBatch reducer - device data + heartbeats", () => {
  it("sorts device folders, null-seeds missing content, and parses heartbeats", () => {
    const s = reducer(init(), {
      type: actions.SET_DEVICE_DATA,
      devices: ["BBBB", "AAAA"],
      results: [
        { deviceId: "AAAA", content: { id: "AAAA" }, lastModified: "2020-01-01T00:00:00Z" },
        { deviceId: "BBBB", content: null, lastModified: "not-a-date" }
      ]
    });
    expect(s.devices).toEqual(["AAAA", "BBBB"]); // sorted
    expect(s.deviceFiles.AAAA).toEqual({ id: "AAAA" });
    expect(s.deviceFiles.BBBB).toBeNull();
    expect(typeof s.heartbeats.AAAA).toBe("number");
    expect(s.heartbeats.BBBB).toBeUndefined(); // unparseable date -> no heartbeat
    expect(s.devicesLoaded).toBe(true);
  });
});

describe("otaBatch reducer - partial load/clear reset semantics", () => {
  const seeded = () =>
    apply(init(), [
      { type: actions.SET_DEVICE_DATA, devices: ["A"], results: [{ deviceId: "A", content: { id: "A" } }] },
      { type: actions.PATCH_ARTIFACTS, patch: { A: { config: { status: "loaded" } } } },
      { type: actions.SET_SELECTION, selected: { A: true } },
      { type: actions.SET_QUERY, query: "abc" }
    ]);

  it("SET_PARTIAL resets selection/evaluations/query/run but keeps devices + artifacts", () => {
    const s = reducer(seeded(), {
      type: actions.SET_PARTIAL,
      partial: { a: 1 },
      blockers: ["b"],
      notes: ["n"]
    });
    expect(s.partial).toEqual({ a: 1 });
    expect(s.partialBlockers).toEqual(["b"]);
    expect(s.selected).toEqual({});
    expect(s.evaluations).toEqual({});
    expect(s.query).toBe("");
    expect(s.run.active).toBe(false);
    // preserved
    expect(s.devices).toEqual(["A"]);
    expect(s.artifacts.A).toBeDefined();
  });

  it("CLEAR_PARTIAL drops the partial and resets selection, keeping devices", () => {
    const s = reducer(reducer(seeded(), { type: actions.SET_PARTIAL, partial: { a: 1 } }), {
      type: actions.CLEAR_PARTIAL
    });
    expect(s.partial).toBeNull();
    expect(s.partialBlockers).toEqual([]);
    expect(s.selected).toEqual({});
    expect(s.devices).toEqual(["A"]);
  });
});

describe("otaBatch reducer - stale evaluation waves", () => {
  it("drops a SET_EVALUATIONS whose token no longer matches", () => {
    const s = apply(init(), [
      { type: actions.SET_SELECTION, selected: { A: true } },
      { type: actions.BUMP_EVAL_TOKEN }, // evalToken -> 1
      { type: actions.BUMP_EVAL_TOKEN } // evalToken -> 2
    ]);
    // a late wave from token 1 is ignored
    const stale = reducer(s, {
      type: actions.SET_EVALUATIONS,
      token: 1,
      evaluations: { A: { eligible: true } }
    });
    expect(stale.evaluations).toEqual({});
    expect(stale.selected).toEqual({ A: true });
    // the current wave (token 2) is applied and prunes selection
    const fresh = reducer(s, {
      type: actions.SET_EVALUATIONS,
      token: 2,
      evaluations: { A: { eligible: false } }
    });
    expect(fresh.evaluations.A).toEqual({ eligible: false });
    expect(fresh.selected).toEqual({});
  });
});

describe("otaBatch reducer - full resets", () => {
  it("RESET and app-wide logout both return the initial state (no partial survives)", () => {
    const dirty = apply(init(), [
      { type: actions.SET_DEVICE_DATA, devices: ["A"], results: [{ deviceId: "A", content: { id: "A" } }] },
      { type: actions.SET_PARTIAL, partial: { a: 1 } }
    ]);
    expect(reducer(dirty, { type: actions.RESET })).toEqual(init());
    expect(reducer(dirty, { type: "common/SET_LOGOUT" })).toEqual(init());
  });
});

describe("otaBatch reducer - RUN_DEVICE_STATUS counter edges", () => {
  it("does not count non-terminal transitions", () => {
    const s = apply(init(), [
      { type: actions.RUN_START, deviceIds: ["A"] },
      status("A", "submitting")
    ]);
    expect(s.run.finished).toBe(0);
    expect(s.run.failed).toBe(0);
  });

  it("error -> submitted (in-run retry) decrements failed without double-counting finished", () => {
    const s = apply(init(), [
      { type: actions.RUN_START, deviceIds: ["A"] },
      status("A", "error", "boom"), // finished 1, failed 1
      status("A", "submitted") // finished stays 1, failed -> 0
    ]);
    expect(s.run.finished).toBe(1);
    expect(s.run.failed).toBe(0);
  });

  it("submitted -> submitted does not double-count", () => {
    const s = apply(init(), [
      { type: actions.RUN_START, deviceIds: ["A"] },
      status("A", "submitted"),
      status("A", "submitted")
    ]);
    expect(s.run.finished).toBe(1);
  });
});
