import React from "react";
import { connect } from "react-redux";

import web from "../web";
import * as actions from "./actions";
import LeftPanel from "./LeftPanel";
import OtaDeviceTable from "./OtaDeviceTable";
import RunFooter from "./RunFooter";
import ConfirmSubmitModal from "./ConfirmSubmitModal";

// Tab bar + 25/75 widget layout + run footer. In partial mode the device
// table is revealed only once a valid partial config is loaded (step-by-step
// journey); in encryption mode selecting the tab is step 1, so the table
// shows right away.
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
    const { mode, partial, partialBlockers, devicesLoaded, runActive, setMode } =
      this.props;

    if (!web.LoggedIn()) {
      return (
        <div className="ota-batch-section">
          <p className="loading-delay">
            Please sign in to use the OTA batch manager
          </p>
        </div>
      );
    }

    const tableVisible =
      mode === "encryption" || (partial && partialBlockers.length === 0);

    return (
      <div className="ota-batch-section">
        <span className="widget-title ota-page-title">OTA Batch Manager</span>
        <div className="ota-tabs">
          <button
            type="button"
            className={mode === "partial" ? "ota-tab ota-tab-active" : "ota-tab"}
            disabled={runActive}
            onClick={() => setMode("partial")}
          >
            Configure devices
          </button>
          <button
            type="button"
            className={
              mode === "encryption" ? "ota-tab ota-tab-active" : "ota-tab"
            }
            disabled={runActive}
            onClick={() => setMode("encryption")}
          >
            Encrypt passwords
          </button>
        </div>

        <div className="ota-batch-layout">
          <div className="ota-batch-left dashboard-widget">
            <LeftPanel />
          </div>
          <div className="ota-batch-right dashboard-widget">
            {tableVisible ? (
              <OtaDeviceTable />
            ) : (
              // blank until a partial is loaded (the step guide lives in the
              // left panel); only a transient device-loading hint is shown
              <div className="ota-batch-placeholder">
                {!devicesLoaded ? (
                  <p className="loading-delay">Loading devices ...</p>
                ) : null}
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
  mode: state.otaBatch.mode,
  partial: state.otaBatch.partial,
  partialBlockers: state.otaBatch.partialBlockers,
  devicesLoaded: state.otaBatch.devicesLoaded,
  runActive: state.otaBatch.run.active
});

const mapDispatchToProps = (dispatch) => ({
  setMode: (mode) => dispatch(actions.setMode(mode)),
  teardown: () => dispatch(actions.teardownView())
});

export default connect(mapStateToProps, mapDispatchToProps)(OtaBatchSection);
