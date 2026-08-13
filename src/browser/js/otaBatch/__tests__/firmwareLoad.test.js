// loadFirmwareFile thunk + the firmware<->config mutual-exclusion reducer
// transitions. Real store/reducer/cache/evaluate; the firmware.bin parsing
// trio (firmwareSpan/parseFirmwareBin/checkKnownFirmware) and the bundled
// schema lookup (loadFile) are mocked - everything else runs for real.

vi.mock("../../web", () => ({
  __esModule: true,
  default: {
    LoggedIn: vi.fn(() => true),
    PresignedGet: vi.fn(({ bucket, object }) =>
      Promise.resolve({ url: "http://fake/" + bucket + "/" + object })
    ),
    PutObject: vi.fn(() => Promise.resolve())
  }
}));
vi.mock("../../history", () => ({
  __esModule: true,
  default: { push: vi.fn(), location: { pathname: "/ota-batch-manager/" } }
}));
vi.mock("../../dashboardStatus/actions", () => ({
  fetchDeviceFileContentAll: vi.fn(() => () => Promise.resolve([]))
}));
vi.mock("../../alert/actions", () => ({
  set: vi.fn((alert) => ({ type: "alert/SET", alert }))
}));
vi.mock("../submitEngine", () => ({
  startRun: vi.fn(() => Promise.resolve()),
  retryRun: vi.fn(() => Promise.resolve()),
  abortRun: vi.fn(),
  invalidateRun: vi.fn()
}));
vi.mock("config-editor-tools", async () => {
  const actual = await vi.importActual("config-editor-tools");
  return {
    ...actual,
    migration: {
      ...actual.migration,
      firmwareSpan: vi.fn(() => 128),
      parseFirmwareBin: vi.fn(),
      checkKnownFirmware: vi.fn(() => true)
    }
  };
});
vi.mock("config-editor-base", async () => {
  const actual = await vi.importActual("config-editor-base");
  return { ...actual, loadFile: vi.fn() };
});

import { createStore, combineReducers, applyMiddleware } from "redux";
import thunk from "redux-thunk";

import * as alertActions from "../../alert/actions";
import { migration } from "config-editor-tools";
import { loadFile } from "config-editor-base";
import otaBatchReducer from "../reducer";
import * as actions from "../actions";
import * as cache from "../cache";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["general", "log", "can_1", "can_2"],
  properties: {
    general: {
      type: "object",
      properties: {
        device: { type: "object", properties: { meta: { type: "string" } } },
        security: { type: "object", properties: { kpub: { type: "string" } } }
      }
    },
    log: { type: "object" },
    can_1: { type: "object" },
    can_2: { type: "object" },
    connect: { type: "object" }
  }
};

const baseConfig = () => ({
  general: { device: { meta: "fleet-x" }, security: { kpub: "" } },
  log: { file: { split_size: 10 } },
  can_1: { phy: { mode: 0 } },
  can_2: { phy: { mode: 0 } }
});

const deviceJsonFor = (id) => ({
  id,
  type: "0000001F",
  kpub: "A".repeat(88),
  fw_ver: "01.09.01",
  cfg_ver: "01.09",
  cfg_name: "config-01.09.json",
  sch_name: "schema-01.09.json",
  cfg_crc32: "",
  log_meta: "device-" + id
});

const initial = otaBatchReducer(undefined, { type: "@@INIT" });
const makeStore = (otaOverrides = {}) =>
  createStore(
    combineReducers({ otaBatch: otaBatchReducer }),
    { otaBatch: { ...initial, ...otaOverrides } },
    applyMiddleware(thunk)
  );

const seedLoaded = (id, config = baseConfig()) => {
  const text = JSON.stringify(config, null, 2);
  cache.setConfig(id, text);
  cache.setSchema(id, JSON.stringify(SCHEMA));
  const crc = cache.crc32Hex(text);
  return {
    deviceFile: { ...deviceJsonFor(id), cfg_crc32: crc },
    artifact: {
      config: { status: "loaded", crc32: crc },
      schema: { status: "loaded" }
    },
    crc
  };
};

// store with one fully-loaded device so ensureArtifacts -> evaluateAll runs
const makeLoadedStore = (id, extra = {}) => {
  const { deviceFile, artifact } = seedLoaded(id);
  return makeStore({
    devices: [id],
    devicesLoaded: true,
    artifactsRequested: true,
    deviceFiles: { [id]: deviceFile },
    heartbeats: { [id]: Date.now() },
    artifacts: { [id]: artifact },
    ...extra
  });
};

const fakeBin = (size = 1024) => {
  const buf = new ArrayBuffer(64);
  return {
    name: "firmware.bin",
    size,
    slice: vi.fn(() => ({ arrayBuffer: () => Promise.resolve(buf) }))
  };
};

const officialFw = (overrides = {}) => ({
  deviceType: "CANedge2",
  fwVer: "01.09.05",
  revision: "01.09",
  schema: SCHEMA,
  defaultConfig: baseConfig(),
  configName: "config-01.09.json",
  schemaName: "schema-01.09.json",
  ...overrides
});

const lastAlert = () => {
  const calls = alertActions.set.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
};

beforeEach(() => {
  cache.clearAll();
  migration.firmwareSpan.mockClear().mockReturnValue(128);
  migration.parseFirmwareBin.mockReset();
  migration.checkKnownFirmware.mockClear().mockReturnValue(true);
  loadFile.mockReset().mockReturnValue(SCHEMA);
  alertActions.set.mockClear();
  global.fetch = vi.fn();
});

describe("loadFirmwareFile", () => {
  it("loads a verified firmware: cache + redux summary set, evaluations re-run", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id);
    migration.parseFirmwareBin.mockReturnValue(officialFw());

    await store.dispatch(actions.loadFirmwareFile(fakeBin()));

    const s = store.getState().otaBatch;
    expect(s.loadedFirmware).toEqual({
      fileName: "firmware.bin",
      deviceType: "CANedge2",
      fwVer: "01.09.05",
      revision: "01.09"
    });
    expect(s.activeTab).toBe("fw");
    const fw = cache.getFirmware();
    expect(fw.file.name).toBe("firmware.bin");
    expect(typeof fw.targetValidator).toBe("function");
    // device on 01.09.01 vs firmware 01.09.05 -> patch-only, eligible
    expect(s.evaluations[id].eligible).toBe(true);
    expect(s.evaluations[id].fw).toMatchObject({
      willUpdate: true,
      willMigrate: false
    });
    expect(alertActions.set).not.toHaveBeenCalled();
  });

  it("clears a loaded partial and the encrypt toggle (mutual exclusion)", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id, {
      partial: { general: { device: { meta: "x" } } },
      encryptPasswords: true
    });
    migration.parseFirmwareBin.mockReturnValue(officialFw());

    await store.dispatch(actions.loadFirmwareFile(fakeBin()));

    const s = store.getState().otaBatch;
    expect(s.loadedFirmware).not.toBeNull();
    expect(s.partial).toBeNull();
    expect(s.encryptPasswords).toBe(false);
  });

  it("rejects an unsupported firmware revision (alert, nothing loaded)", async () => {
    const store = makeLoadedStore("AABBCCDD");
    migration.parseFirmwareBin.mockReturnValue(
      officialFw({ revision: "01.06", fwVer: "01.06.02" })
    );

    await store.dispatch(actions.loadFirmwareFile(fakeBin()));

    expect(store.getState().otaBatch.loadedFirmware).toBeNull();
    expect(cache.getFirmware()).toBeNull();
    expect(lastAlert().message).toContain("supports firmware revisions");
  });

  it("rejects a firmware without a bundled reference schema", async () => {
    const store = makeLoadedStore("AABBCCDD");
    migration.parseFirmwareBin.mockReturnValue(officialFw());
    loadFile.mockReturnValue(null);

    await store.dispatch(actions.loadFirmwareFile(fakeBin()));

    expect(store.getState().otaBatch.loadedFirmware).toBeNull();
    expect(lastAlert().message).toContain("No reference schema");
  });

  it("rejects an unrecognized (custom) firmware", async () => {
    const store = makeLoadedStore("AABBCCDD");
    migration.parseFirmwareBin.mockReturnValue(officialFw());
    migration.checkKnownFirmware.mockReturnValue(false);

    await store.dispatch(actions.loadFirmwareFile(fakeBin()));

    expect(store.getState().otaBatch.loadedFirmware).toBeNull();
    expect(lastAlert().message).toContain("not supported");
  });

  it("surfaces a parse failure as an unreadable firmware.bin", async () => {
    const store = makeLoadedStore("AABBCCDD");
    migration.parseFirmwareBin.mockImplementation(() => {
      throw new Error("bad magic");
    });

    await store.dispatch(actions.loadFirmwareFile(fakeBin()));

    expect(store.getState().otaBatch.loadedFirmware).toBeNull();
    expect(lastAlert().message).toContain("Could not read this firmware.bin");
    expect(lastAlert().message).toContain("bad magic");
  });
});

describe("clearFirmware", () => {
  it("drops cache + redux state and re-evaluates (devices not stuck on 'Evaluating')", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id);
    migration.parseFirmwareBin.mockReturnValue(officialFw());
    await store.dispatch(actions.loadFirmwareFile(fakeBin()));
    expect(store.getState().otaBatch.evaluations[id].fw).toBeDefined();

    await store.dispatch(actions.clearFirmware());

    const s = store.getState().otaBatch;
    expect(s.loadedFirmware).toBeNull();
    expect(cache.getFirmware()).toBeNull();
    // base (no-firmware) evaluation restored, not an empty map
    expect(s.evaluations[id]).toBeDefined();
    expect(s.evaluations[id].fw).toBeUndefined();
  });
});

describe("partial load clears a loaded firmware (mutual exclusion, other direction)", () => {
  it("SET_PARTIAL resets loadedFirmware in redux AND drops the cached File", async () => {
    const id = "AABBCCDD";
    const store = makeLoadedStore(id);
    migration.parseFirmwareBin.mockReturnValue(officialFw());
    await store.dispatch(actions.loadFirmwareFile(fakeBin()));
    expect(cache.getFirmware()).not.toBeNull();

    await store.dispatch(
      actions.loadPartialFile(
        "p.json",
        JSON.stringify({ general: { device: { meta: "y" } } })
      )
    );

    const s = store.getState().otaBatch;
    expect(s.partial).toEqual({ general: { device: { meta: "y" } } });
    expect(s.loadedFirmware).toBeNull();
    expect(s.activeTab).toBe("config");
    expect(cache.getFirmware()).toBeNull();
  });
});

describe("run-active guards", () => {
  const runActive = { run: { ...initial.run, active: true } };

  it("loadFirmwareFile is a no-op during a run (file never read)", async () => {
    const store = makeStore(runActive);
    const file = fakeBin();

    await store.dispatch(actions.loadFirmwareFile(file));

    expect(file.slice).not.toHaveBeenCalled();
    expect(store.getState().otaBatch.loadedFirmware).toBeNull();
  });

  it("setActiveTab is a no-op during a run", () => {
    const store = makeStore(runActive);
    store.dispatch(actions.setActiveTab("fw"));
    expect(store.getState().otaBatch.activeTab).toBe("config");
  });

  it("clearFirmware is a no-op during a run", async () => {
    const loadedFirmware = {
      fileName: "firmware.bin",
      deviceType: "CANedge2",
      fwVer: "01.09.05",
      revision: "01.09"
    };
    const store = makeStore({ ...runActive, loadedFirmware });

    await store.dispatch(actions.clearFirmware());

    expect(store.getState().otaBatch.loadedFirmware).toEqual(loadedFirmware);
  });
});
