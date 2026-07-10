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
