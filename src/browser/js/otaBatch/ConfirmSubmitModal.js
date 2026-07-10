import React from "react";
import { connect } from "react-redux";

import * as actions from "./actions";
import CollapsiblePreview from "./CollapsiblePreview";
import { getAggregatedWarnings, getEncryptActive } from "./selectors";

// Pre-submission confirmation: the user must see exactly what goes where and
// explicitly acknowledge before any PUT happens
export class ConfirmSubmitModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      acknowledged: false,
      verifiedOnOne: false,
      previewOpen: false,
      targetsOpen: false,
      fieldsOpen: false
    };
  }

  componentDidUpdate(prevProps) {
    if (this.props.open && !prevProps.open) {
      this.setState({
        acknowledged: false,
        verifiedOnOne: false,
        previewOpen: false,
        targetsOpen: false,
        fieldsOpen: false
      });
    }
  }

  render() {
    const {
      open,
      encryptActive,
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

    const willEncrypt = (ev) =>
      encryptActive && ev && ev.enc && ev.enc.hasPlain && ev.enc.compatible;
    // only devices that will actually change (partial change and/or encryption)
    const deviceIds = Object.keys(selected)
      .filter((deviceId) => {
        const ev = evaluations[deviceId];
        return ev && ev.eligible && (ev.partialChanges || willEncrypt(ev));
      })
      .sort();

    // per-section encryption counts across the devices that will be encrypted
    const encryptionCounts = {};
    if (encryptActive) {
      deviceIds.forEach((deviceId) => {
        const ev = evaluations[deviceId];
        if (!willEncrypt(ev)) return;
        (ev.enc.summary || []).forEach((row) => {
          encryptionCounts[row] = (encryptionCounts[row] || 0) + 1;
        });
      });
    }

    // static label (the title already states whether encryption is applied) so
    // the button width does not jump between modes
    const submitLabel = "Submit to S3";

    return (
      <div className="show modal-custom-wrapper">
        <div className="show modal-custom ota-confirm-modal">
          <div className="modal-review-changes-header">
            <button type="button" className="close" onClick={closeConfirm}>
              <span style={{ color: "gray" }}>&times;</span>
            </button>
            <span className="widget-title">
              {(encryptActive ? "Encrypt & submit to " : "Submit to ") +
                deviceIds.length +
                " device" +
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

            {partial ? (
              <CollapsiblePreview
                open={this.state.previewOpen}
                onToggle={() =>
                  this.setState({ previewOpen: !this.state.previewOpen })
                }
                data={partial}
                label="Show partial config preview"
              />
            ) : null}

            {encryptActive && Object.keys(encryptionCounts).length ? (
              <div style={{ marginTop: "10px" }}>
                <div
                  onClick={() =>
                    this.setState({ fieldsOpen: !this.state.fieldsOpen })
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
                      this.state.fieldsOpen
                        ? "fa fa-angle-down"
                        : "fa fa-angle-right"
                    }
                    style={{ marginRight: "6px", width: "8px" }}
                  />
                  Show fields to encrypt ({Object.keys(encryptionCounts).length})
                </div>
                {this.state.fieldsOpen ? (
                  <pre
                    className="browse-file-preview"
                    style={{
                      maxHeight: "200px",
                      overflow: "auto",
                      marginTop: "10px"
                    }}
                  >
                    {Object.keys(encryptionCounts)
                      .map(
                        (row) =>
                          row +
                          "  (" +
                          encryptionCounts[row] +
                          " device" +
                          (encryptionCounts[row] === 1 ? "" : "s") +
                          ")"
                      )
                      .join("\n")}
                  </pre>
                ) : null}
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
            {/* fleet-safety gate: for a multi-device rollout, require the user to
                confirm they have already validated the update on a single device */}
            {deviceIds.length > 1 ? (
              <div
                className="ota-confirm-ack"
                onClick={() =>
                  this.setState({ verifiedOnOne: !this.state.verifiedOnOne })
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer"
                }}
              >
                <span
                  style={{ width: "20px", flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="checkbox-design">
                    <input
                      type="checkbox"
                      checked={this.state.verifiedOnOne}
                      onChange={() =>
                        this.setState({
                          verifiedOnOne: !this.state.verifiedOnOne
                        })
                      }
                    />
                    <span></span>
                  </label>
                </span>
                <span>I have already verified this update on 1 device</span>
              </div>
            ) : null}
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
              disabled={
                !this.state.acknowledged ||
                (deviceIds.length > 1 && !this.state.verifiedOnOne) ||
                deviceIds.length === 0
              }
              onClick={startRun}
            >
              {submitLabel}
            </button>
            <button
              type="button"
              className="btn btn-white"
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
  encryptActive: getEncryptActive(state),
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
