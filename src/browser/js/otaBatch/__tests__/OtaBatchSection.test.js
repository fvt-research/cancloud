// Tab-strip mutual exclusion. The firmware/TLS tabs must follow the EFFECTIVE
// encrypt state (what the checkbox shows), not the raw encryptPasswords flag -
// a leftover flag with no eligible selection used to grey them out invisibly.

jest.mock("../../web", () => ({
  __esModule: true,
  default: { LoggedIn: jest.fn(() => true) }
}));

import React from "react";
import { shallow } from "enzyme";

import { OtaBatchSection } from "../OtaBatchSection";

const render = (over = {}) =>
  shallow(
    <OtaBatchSection
      devicesLoaded={true}
      activeTab="config"
      loadedFirmware={null}
      loadedTls={null}
      partial={null}
      encryptActive={false}
      runActive={false}
      setActiveTab={jest.fn()}
      teardown={jest.fn()}
      {...over}
    />
  );

const tab = (wrapper, label) =>
  wrapper.find("button.ota-tab").filterWhere((node) => node.children().text() === label);

describe("OtaBatchSection tab strip", () => {
  it("enables every tab when nothing is loaded", () => {
    const w = render();
    ["Config", "Firmware", "TLS"].forEach((label) => {
      expect(tab(w, label).prop("disabled")).toBe(false);
    });
  });

  it("a loaded partial disables the firmware and TLS tabs", () => {
    const w = render({ partial: { log: {} } });
    expect(tab(w, "Firmware").prop("disabled")).toBe(true);
    expect(tab(w, "TLS").prop("disabled")).toBe(true);
    expect(tab(w, "Config").prop("disabled")).toBe(false);
  });

  it("an ARMED encryption batch (no partial) disables the firmware and TLS tabs", () => {
    const w = render({ encryptActive: true });
    expect(tab(w, "Firmware").prop("disabled")).toBe(true);
    expect(tab(w, "TLS").prop("disabled")).toBe(true);
  });

  it("re-enables the firmware/TLS tabs once the partial is cleared", () => {
    // the bug: after clearing a partial the raw encryptPasswords flag could
    // still be true (checkbox renders unticked because nothing is selected),
    // leaving both tabs greyed out with no visible cause
    const w = render({ partial: null, encryptActive: false });
    expect(tab(w, "Firmware").prop("disabled")).toBe(false);
    expect(tab(w, "TLS").prop("disabled")).toBe(false);
  });

  it("a loaded firmware or TLS bundle keeps the other two tabs mutually exclusive", () => {
    const fw = render({ loadedFirmware: { fileName: "firmware.bin" }, activeTab: "fw" });
    expect(tab(fw, "Config").prop("disabled")).toBe(true);
    expect(tab(fw, "TLS").prop("disabled")).toBe(true);
    expect(tab(fw, "Firmware").prop("disabled")).toBe(false);

    const tls = render({ loadedTls: { fileName: "certs_server.p7b" }, activeTab: "tls" });
    expect(tab(tls, "Config").prop("disabled")).toBe(true);
    expect(tab(tls, "Firmware").prop("disabled")).toBe(true);
    expect(tab(tls, "TLS").prop("disabled")).toBe(false);
  });

  it("a run in progress disables all tabs", () => {
    const w = render({ runActive: true });
    ["Config", "Firmware", "TLS"].forEach((label) => {
      expect(tab(w, label).prop("disabled")).toBe(true);
    });
  });
});
