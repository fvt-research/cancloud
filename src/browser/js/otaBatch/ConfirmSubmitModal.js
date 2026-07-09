import React from "react";
import { connect } from "react-redux";

import * as actions from "./actions";
import CollapsiblePreview from "./CollapsiblePreview";
import { getAggregatedWarnings } from "./selectors";

// Pre-submission confirmation: the user must see exactly what goes where and
// explicitly acknowledge before any PUT happens
export class ConfirmSubmitModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = { acknowledged: false, previewOpen: false, targetsOpen: false };
  }

  componentDidUpdate(prevProps) {
    if (this.props.open && !prevProps.open) {
      this.setState({ acknowledged: false, previewOpen: false, targetsOpen: false });
    }
  }

  render() {
    const {
      open,
      mode,
      partial,
      partialNotes,
      selected,
      deviceFiles,
      evaluations,
      aggregatedWarnings,
      closeConfirm,
      startRun
    } = this.props;

    if (!open) return null;

    const deviceIds = Object.keys(selected)
      .filter(
        (deviceId) =>
          evaluations[deviceId] && evaluations[deviceId].status === "ready"
      )
      .sort();

    // per-section encryption counts across the selected devices
    const encryptionCounts = {};
    if (mode === "encryption") {
      deviceIds.forEach((deviceId) => {
        const summary = evaluations[deviceId].encryptionSummary || [];
        summary.forEach((row) => {
          encryptionCounts[row] = (encryptionCounts[row] || 0) + 1;
        });
      });
    }

    return (
      <div className="show modal-custom-wrapper">
        <div className="show modal-custom ota-confirm-modal">
          <div className="modal-review-changes-header">
            <button type="button" className="close" onClick={closeConfirm}>
              <span style={{ color: "gray" }}>&times;</span>
            </button>
            <span className="widget-title">
              {mode === "partial"
                ? "Submit partial config to " + deviceIds.length + " device" +
                  (deviceIds.length === 1 ? "" : "s")
                : "Encrypt & submit to " + deviceIds.length + " device" +
                  (deviceIds.length === 1 ? "" : "s")}
            </span>
          </div>

          <div className="modal-custom-content ota-confirm-content">
            {/* same toggle styling as CollapsiblePreview below, for consistency */}
            <div style={{ marginTop: "10px" }}>
              <div
                onClick={() =>
                  this.setState({ targetsOpen: !this.state.targetsOpen })
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: "#999999",
                  userSelect: "none"
                }}
              >
                <i
                  className={
                    this.state.targetsOpen
                      ? "fa fa-angle-down"
                      : "fa fa-angle-right"
                  }
                  style={{ marginRight: "6px", width: "8px" }}
                />
                Show target devices ({deviceIds.length})
              </div>
              {this.state.targetsOpen ? (
                <pre
                  className="browse-file-preview"
                  style={{ maxHeight: "200px", overflow: "auto", marginTop: "10px" }}
                >
                  {deviceIds
                    .map((deviceId) => {
                      const deviceJson = deviceFiles[deviceId] || {};
                      return (
                        deviceId +
                        "/" +
                        (deviceJson.cfg_name || "?") +
                        (deviceJson.log_meta
                          ? "  (" + deviceJson.log_meta + ")"
                          : "")
                      );
                    })
                    .join("\n")}
                </pre>
              ) : null}
            </div>

            {mode === "partial" && partial ? (
              <CollapsiblePreview
                open={this.state.previewOpen}
                onToggle={() =>
                  this.setState({ previewOpen: !this.state.previewOpen })
                }
                data={partial}
                label="Show partial config preview"
              />
            ) : null}

            {mode === "encryption" && Object.keys(encryptionCounts).length ? (
              <div className="ota-confirm-warnings">
                <p className="reduced-margin">Fields to encrypt</p>
                {Object.keys(encryptionCounts).map((row, index) => (
                  <p className="ota-panel-note" key={"enc" + index}>
                    {row}{" "}
                    <span className="grey-text">
                      ({encryptionCounts[row]} device
                      {encryptionCounts[row] === 1 ? "" : "s"})
                    </span>
                  </p>
                ))}
                <p className="field-description">
                  Each device receives its own unique server public key and
                  ciphertexts - nothing is shared across devices.
                </p>
              </div>
            ) : null}

            {partialNotes.length ? (
              <div className="ota-confirm-warnings">
                {partialNotes.map((message, index) => (
                  <p className="orange-text ota-panel-note" key={"note" + index}>
                    <i className="fa fa-exclamation-triangle" /> {message}
                  </p>
                ))}
              </div>
            ) : null}

            {aggregatedWarnings.length ? (
              <div className="ota-confirm-warnings">
                <p className="reduced-margin">Warnings</p>
                {aggregatedWarnings.map((warning, index) => (
                  <p className="orange-text ota-panel-note" key={"warn" + index}>
                    <i className="fa fa-exclamation-triangle" /> {warning.message}{" "}
                    <span className="grey-text">
                      ({warning.devices} device
                      {warning.devices === 1 ? "" : "s"})
                    </span>
                  </p>
                ))}
              </div>
            ) : null}

            {/* checkbox markup copied from the editor OBD tool: the label wraps
                only the input + an empty span (the check box), the caption is a
                flex sibling so it stays vertically centered with the box */}
            <div
              className="ota-confirm-ack"
              onClick={() =>
                this.setState({ acknowledged: !this.state.acknowledged })
              }
              style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
            >
              <span
                style={{ width: "20px", flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <label className="checkbox-design">
                  <input
                    type="checkbox"
                    checked={this.state.acknowledged}
                    onChange={() =>
                      this.setState({ acknowledged: !this.state.acknowledged })
                    }
                  />
                  <span></span>
                </label>
              </span>
              <span>
                I understand this will overwrite the Configuration File of{" "}
                {deviceIds.length} device{deviceIds.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="modal-custom-footer">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!this.state.acknowledged || deviceIds.length === 0}
              onClick={startRun}
            >
              {mode === "partial" ? "Submit to S3" : "Encrypt & submit to S3"}
            </button>
            <button
              type="button"
              className="btn btn-white ml15"
              onClick={closeConfirm}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  open: state.otaBatch.confirmOpen,
  mode: state.otaBatch.mode,
  partial: state.otaBatch.partial,
  partialNotes: state.otaBatch.partialNotes,
  partialSource: state.otaBatch.partialSource,
  selected: state.otaBatch.selected,
  deviceFiles: state.otaBatch.deviceFiles,
  evaluations: state.otaBatch.evaluations,
  aggregatedWarnings: getAggregatedWarnings(state)
});

const mapDispatchToProps = (dispatch) => ({
  closeConfirm: () => dispatch(actions.setConfirmOpen(false)),
  startRun: () => dispatch(actions.startRun())
});

export default connect(mapStateToProps, mapDispatchToProps)(ConfirmSubmitModal);
