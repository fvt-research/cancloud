import React from "react";
import { connect } from "react-redux";

import web from "../web";
import * as actions from "./actions";
import { getEncryptActive } from "./selectors";
import LeftPanel from "./LeftPanel";
import EncryptPanel from "./EncryptPanel";
import FwPanel from "./FwPanel";
import TlsPanel from "./TlsPanel";
import OtaDeviceTable from "./OtaDeviceTable";
import RunFooter from "./RunFooter";
import ConfirmSubmitModal from "./ConfirmSubmitModal";

// Single unified view: a 25/75 layout with the device dashboard on the right
// (shown as soon as devices load) and a stacked left column - the partial
// config loader on top and the optional "Encrypt passwords" control below.
export class OtaBatchSection extends React.Component {
  constructor(props) {
    super(props);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
  }

  handleBeforeUnload(e) {
    if (this.props.runActive) {
      e.preventDefault();
      e.returnValue =
        "A batch submission is still running - leaving now stops it.";
      return e.returnValue;
    }
    return undefined;
  }

  componentDidMount() {
    window.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  componentWillUnmount() {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    // safety: never let a loaded partial / cached device artifacts survive
    // navigation away (e.g. logout + login to a different bucket)
    this.props.teardown();
  }

  render() {
    const {
      devicesLoaded,
      activeTab,
      loadedFirmware,
      loadedTls,
      partial,
      encryptActive,
      runActive,
      setActiveTab
    } = this.props;
    // the EFFECTIVE encrypt state, not the raw toggle: a leftover
    // encryptPasswords flag with no eligible selection renders as an unticked
    // checkbox, and must not keep the firmware/TLS tabs greyed out
    const hasConfigState = !!partial || encryptActive;

    if (!web.LoggedIn()) {
      return (
        <div className="ota-batch-section">
          <p className="loading-delay">
            Please sign in to use the OTA batch manager
          </p>
        </div>
      );
    }

    // the device dashboard is always shown; only a transient loading hint
    // appears before device data arrives
    const tableVisible = devicesLoaded;

    return (
      <div className="ota-batch-section">
        <span className="widget-title ota-page-title">OTA Batch Manager</span>

        <div className="ota-batch-layout">
          <div className="ota-batch-left">
            <div className="dashboard-widget ota-left-widget">
              <div className="ota-tab-strip">
                <button
                  type="button"
                  className={
                    "ota-tab" +
                    (activeTab === "config" ? " ota-tab-active" : "")
                  }
                  disabled={runActive || !!loadedFirmware || !!loadedTls}
                  onClick={() => setActiveTab("config")}
                >
                  Config
                </button>
                <button
                  type="button"
                  className={
                    "ota-tab" + (activeTab === "fw" ? " ota-tab-active" : "")
                  }
                  disabled={runActive || hasConfigState || !!loadedTls}
                  onClick={() => setActiveTab("fw")}
                >
                  Firmware
                </button>
                <button
                  type="button"
                  className={
                    "ota-tab" + (activeTab === "tls" ? " ota-tab-active" : "")
                  }
                  disabled={runActive || hasConfigState || !!loadedFirmware}
                  onClick={() => setActiveTab("tls")}
                >
                  TLS
                </button>
              </div>
              <div className="ota-tab-body">
                {activeTab === "fw" ? (
                  <FwPanel />
                ) : activeTab === "tls" ? (
                  <TlsPanel />
                ) : (
                  <div>
                    <LeftPanel />
                    <hr className="ota-section-divider" />
                    <EncryptPanel />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="ota-batch-right dashboard-widget">
            {tableVisible ? (
              <OtaDeviceTable />
            ) : (
              <div className="ota-batch-placeholder">
                <p className="loading-delay">Loading devices ...</p>
              </div>
            )}
          </div>
        </div>

        {tableVisible ? <RunFooter /> : null}

        <ConfirmSubmitModal />
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  devicesLoaded: state.otaBatch.devicesLoaded,
  activeTab: state.otaBatch.activeTab,
  loadedFirmware: state.otaBatch.loadedFirmware,
  loadedTls: state.otaBatch.loadedTls,
  partial: state.otaBatch.partial,
  encryptActive: getEncryptActive(state),
  runActive: state.otaBatch.run.active
});

const mapDispatchToProps = (dispatch) => ({
  teardown: () => dispatch(actions.teardownView()),
  setActiveTab: (tab) => dispatch(actions.setActiveTab(tab))
});

export default connect(mapStateToProps, mapDispatchToProps)(OtaBatchSection);
