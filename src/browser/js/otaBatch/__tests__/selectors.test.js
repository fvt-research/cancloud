import { getEncryptEnablement, getEncryptActive } from "../selectors";

// minimal state slice for the encryption-enablement selectors
const state = (selected, evaluations, encryptPasswords = false) => ({
  otaBatch: { selected, evaluations, encryptPasswords }
});
const enc = (hasPlain, compatible) => ({ enc: { hasPlain, compatible } });

describe("getEncryptEnablement", () => {
  it("enabled when a compatible candidate is selected and none block", () => {
    const r = getEncryptEnablement(
      state(
        { A: true, B: true },
        { A: enc(true, true), B: enc(false, false) } // B neutral (nothing to encrypt)
      )
    );
    expect(r.enabled).toBe(true);
    expect(r.candidates).toBe(1);
    expect(r.blockers).toBe(0);
  });

  it("disabled + reason when a selected device is incompatible", () => {
    const r = getEncryptEnablement(
      state(
        { A: true, B: true },
        { A: enc(true, true), B: enc(true, false) } // B mixed/over-length -> blocker
      )
    );
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain("can't be encrypted");
  });

  it("disabled when nothing selected has plaintext to encrypt", () => {
    const r = getEncryptEnablement(state({ A: true }, { A: enc(false, false) }));
    expect(r.enabled).toBe(false);
    expect(r.reason).toContain("plain-text");
  });

  it("disabled with an empty selection", () => {
    expect(getEncryptEnablement(state({}, {})).enabled).toBe(false);
  });
});

describe("getEncryptActive", () => {
  it("true only when the toggle is on AND the selection allows it", () => {
    const evals = { A: enc(true, true) };
    expect(getEncryptActive(state({ A: true }, evals, true))).toBe(true);
    expect(getEncryptActive(state({ A: true }, evals, false))).toBe(false);
    // toggle on but an incompatible device is selected -> not active
    expect(
      getEncryptActive(
        state(
          { A: true, B: true },
          { A: enc(true, true), B: enc(true, false) },
          true
        )
      )
    ).toBe(false);
  });
});
