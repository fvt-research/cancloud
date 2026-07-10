import React from "react";
import { connect } from "react-redux";

import * as actions from "./actions";
import { getCounts, getEncryptActive } from "./selectors";
import { encryptionCrypto } from "config-editor-tools";

// Submission controls below the 25/75 layout: submit button, live run
// progress, abort and retry-failed
export class RunFooter extends React.Component {
  render() {
    const {
      encryptActive,
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
    // nothing to submit unless there is a valid partial to apply and/or the
    // encrypt toggle is effectively on
    const submitDisabled =
      run.active ||
      counts.selected === 0 ||
      browserBlocked ||
      (!hasPartial && !encryptActive);

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
