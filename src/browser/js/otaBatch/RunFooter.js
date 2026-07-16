import React from "react";
import { connect } from "react-redux";

import * as actions from "./actions";
import {
  getCounts,
  getEncryptActive,
  getFirmwareActive,
  getTlsActive
} from "./selectors";
import { encryptionCrypto } from "config-editor-tools";

// Submission controls below the 25/75 layout: submit button, live run
// progress, abort and retry-failed
export class RunFooter extends React.Component {
  render() {
    const {
      encryptActive,
      firmwareActive,
      tlsActive,
      counts,
      partial,
      partialBlockers,
      run,
      openConfirm,
      abortRun,
      retryFailed
    } = this.props;

    const browserBlocked =
      encryptActive && encryptionCrypto.checkBrowserSupport() !== null;
    const hasPartial = partial && partialBlockers.length === 0;
    // nothing to submit unless there is a valid partial to apply, the encrypt
    // toggle is effectively on, or a firmware.bin / certs_server.p7b is loaded
    const submitDisabled =
      run.active ||
      counts.selected === 0 ||
      browserBlocked ||
      (!hasPartial && !encryptActive && !firmwareActive && !tlsActive);

    return (
      <div className="ota-run-footer">
        {!run.active ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitDisabled}
            onClick={openConfirm}
          >
            Review batch changes
          </button>
        ) : (
          <button type="button" className="btn btn-white" onClick={abortRun}>
            Abort (queued devices)
          </button>
        )}

        {run.active ? (
          <span className="ota-run-status">
            Submitting: {run.finished} / {run.total} done
          </span>
        ) : null}

        {!run.active && run.failed > 0 ? (
          <button type="button" className="btn btn-white" onClick={retryFailed}>
            Retry failed
          </button>
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  encryptActive: getEncryptActive(state),
  firmwareActive: getFirmwareActive(state),
  tlsActive: getTlsActive(state),
  partial: state.otaBatch.partial,
  partialBlockers: state.otaBatch.partialBlockers,
  run: state.otaBatch.run,
  counts: getCounts(state)
});

const mapDispatchToProps = (dispatch) => ({
  openConfirm: () => dispatch(actions.setConfirmOpen(true)),
  abortRun: () => dispatch(actions.abortRun()),
  retryFailed: () => dispatch(actions.retryFailed())
});

export default connect(mapStateToProps, mapDispatchToProps)(RunFooter);
