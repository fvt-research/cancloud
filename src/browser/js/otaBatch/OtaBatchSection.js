import React from "react";
import { connect } from "react-redux";

import web from "../web";
import * as actions from "./actions";
import LeftPanel from "./LeftPanel";
import EncryptPanel from "./EncryptPanel";
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
    const { devicesLoaded } = this.props;

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
            <div className="ota-batch-left-top dashboard-widget">
              <LeftPanel />
            </div>
            <div className="ota-batch-left-bottom dashboard-widget">
              <EncryptPanel />
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
  devicesLoaded: state.otaBatch.devicesLoaded
});

const mapDispatchToProps = (dispatch) => ({
  teardown: () => dispatch(actions.teardownView())
});

export default connect(mapStateToProps, mapDispatchToProps)(OtaBatchSection);
