import * as actions from "./actionTypes";

const initialRun = {
  active: false,
  aborted: false,
  deviceStatus: {}, // deviceId -> { state: queued|submitting|submitted|error|aborted, message? }
  total: 0,
  finished: 0,
  failed: 0
};

const initialState = {
  encryptPasswords: false, // encrypt all plain-text passwords in the (post-merge) config
  partial: null, // parsed partial config object
  partialDeletions: [], // excluded deletion paths (editor transfer)
  partialSource: null, // { kind: "file"|"editor", fileName?, deviceId?, configName?, revision? }
  partialBlockers: [], // batch-level blocking errors
  partialNotes: [], // batch-level non-blocking notes
  devices: [], // all device folder ids (sorted)
  deviceFiles: {}, // deviceId -> parsed device.json | null (missing/unreadable)
  heartbeats: {}, // deviceId -> ms epoch of device.json Last-Modified
  devicesLoaded: false,
  artifacts: {}, // deviceId -> { config: {status, crc32}, schema: {status} }
  artifactsRequested: false,
  evaluations: {}, // deviceId -> { status, eligible, reasons, warnings, targetName, baselineCrc32, partialChanges, currentEncStatus, enc }
  evalToken: 0,
  selected: {}, // deviceId -> true
  query: "",
  confirmOpen: false,
  run: initialRun
};

export default (state = initialState, action) => {
  switch (action.type) {
    case actions.SET_ENCRYPT_PASSWORDS:
      // toggle is a pure display/behaviour switch - eligibility and the loaded
      // partial are unaffected, so we keep selection/evaluations intact
      return { ...state, encryptPasswords: action.value };

    case actions.SET_DEVICE_DATA: {
      const deviceFiles = {};
      const heartbeats = {};
      action.devices.forEach((deviceId) => {
        deviceFiles[deviceId] = null;
      });
      action.results.forEach((result) => {
        if (!result || !result.deviceId) return;
        deviceFiles[result.deviceId] = result.content || null;
        if (result.lastModified) {
          const ms = new Date(result.lastModified).getTime();
          if (!isNaN(ms)) heartbeats[result.deviceId] = ms;
        }
      });
      return {
        ...state,
        devices: action.devices.slice().sort(),
        deviceFiles,
        heartbeats,
        devicesLoaded: true
      };
    }

    case actions.SET_PARTIAL:
      return {
        ...state,
        partial: action.partial,
        partialDeletions: action.deletions || [],
        partialSource: action.source || null,
        partialBlockers: action.blockers || [],
        partialNotes: action.notes || [],
        selected: {},
        evaluations: {},
        query: "",
        confirmOpen: false,
        run: initialRun
      };

    case actions.CLEAR_PARTIAL:
      return {
        ...state,
        partial: null,
        partialDeletions: [],
        partialSource: null,
        partialBlockers: [],
        partialNotes: [],
        selected: {},
        evaluations: {},
        confirmOpen: false,
        run: initialRun
      };

    case actions.SET_ARTIFACTS_REQUESTED:
      return { ...state, artifactsRequested: true };

    case actions.PATCH_ARTIFACTS:
      return { ...state, artifacts: { ...state.artifacts, ...action.patch } };

    case actions.SET_EVALUATIONS: {
      // drop stale evaluation waves
      if (action.token !== state.evalToken) return state;
      // prune selections that are no longer eligible (eligibility is
      // toggle-independent - a partial change OR encryptable plaintext)
      const selected = {};
      Object.keys(state.selected).forEach((deviceId) => {
        const evaluation = action.evaluations[deviceId];
        if (evaluation && evaluation.eligible) {
          selected[deviceId] = true;
        }
      });
      return { ...state, evaluations: action.evaluations, selected };
    }

    case actions.BUMP_EVAL_TOKEN:
      return { ...state, evalToken: state.evalToken + 1 };

    case actions.SET_QUERY:
      return { ...state, query: action.query };

    case actions.TOGGLE_SELECT: {
      const selected = { ...state.selected };
      if (selected[action.deviceId]) {
        delete selected[action.deviceId];
      } else {
        selected[action.deviceId] = true;
      }
      return { ...state, selected };
    }

    case actions.SET_SELECTION:
      return { ...state, selected: action.selected };

    case actions.SET_CONFIRM_OPEN:
      return { ...state, confirmOpen: action.open };

    case actions.RUN_START: {
      const deviceStatus = {};
      action.deviceIds.forEach((deviceId) => {
        deviceStatus[deviceId] = { state: "queued" };
      });
      return {
        ...state,
        confirmOpen: false,
        run: {
          ...initialRun,
          active: true,
          deviceStatus,
          total: action.deviceIds.length
        }
      };
    }

    case actions.RUN_APPEND: {
      // retry-failed path: re-queue devices INTO the existing run rather than
      // starting a fresh one (preserves the other rows' final states and the
      // cumulative summary). Un-count each re-queued device's prior final
      // state; RUN_DEVICE_STATUS re-counts it on the new terminal state. Total
      // is unchanged - these devices were already part of the run.
      const deviceStatus = { ...state.run.deviceStatus };
      let finished = state.run.finished;
      let failed = state.run.failed;
      action.deviceIds.forEach((deviceId) => {
        const prev = deviceStatus[deviceId];
        if (prev && (prev.state === "submitted" || prev.state === "error")) {
          finished -= 1;
          if (prev.state === "error") failed -= 1;
        }
        deviceStatus[deviceId] = { state: "queued" };
      });
      return {
        ...state,
        confirmOpen: false,
        run: {
          ...state.run,
          active: true,
          aborted: false,
          deviceStatus,
          finished,
          failed
        }
      };
    }

    case actions.RUN_DEVICE_STATUS: {
      const prev = state.run.deviceStatus[action.deviceId];
      const wasFinal =
        prev && (prev.state === "submitted" || prev.state === "error");
      const isFinal =
        action.state === "submitted" || action.state === "error";
      return {
        ...state,
        run: {
          ...state.run,
          deviceStatus: {
            ...state.run.deviceStatus,
            [action.deviceId]: { state: action.state, message: action.message }
          },
          finished:
            state.run.finished + (isFinal && !wasFinal ? 1 : 0),
          failed:
            state.run.failed +
            (action.state === "error" && !wasFinal ? 1 : 0) -
            (wasFinal && prev.state === "error" && action.state !== "error"
              ? 1
              : 0)
        }
      };
    }

    case actions.RUN_ABORT_REQUESTED:
      return { ...state, run: { ...state.run, aborted: true } };

    case actions.RUN_DONE:
      return { ...state, run: { ...state.run, active: false } };

    case actions.RESET:
      return initialState;

    // app-wide logout action (buckets/actions SET_LOGOUT) - a partial from a
    // previous session must never survive into another login/bucket
    case "common/SET_LOGOUT":
      return initialState;

    default:
      return state;
  }
};
