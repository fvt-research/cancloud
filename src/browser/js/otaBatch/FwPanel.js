import React from "react";
import { connect } from "react-redux";
import Files from "react-files";

import * as actions from "./actions";
import * as alertActions from "../alert/actions";

// "Update FW" tab widget: load one firmware.bin, verify it, and show a brief
// info block (FW version / device type). Per-device migration + firmware
// eligibility are computed in the device table; this panel only loads the
// single firmware image. Reads only the header + embedded JSON, never the full
// (~50 MB) image (see actions.loadFirmwareFile).
export class FwPanel extends React.Component {
  onFileChange = (files) => {
    if (!files.length) return;
    this.props.loadFirmwareFile(files[0]);
  };

  onFilesError = (error) => {
    this.props.showAlert("info", "Invalid file - " + error.message);
  };

  render() {
    const { loadedFirmware, runActive, clearFirmware } = this.props;

    return (
      <div className="ota-left-panel ota-fw-panel">
        <span className="widget-title">Update firmwares</span>
        <div className="ota-steps">
          <ol>
            <li>Load the firmware.bin for the version you want to update to</li>
            <li>Select devices to update from the table</li>
            <li>
              Review and submit
            </li>
          </ol>
        </div>

        {!loadedFirmware ? (
          <div className="file-dropzone" style={{ marginTop: "12px" }}>
            <Files
              onChange={this.onFileChange}
              onError={this.onFilesError}
              accepts={[".bin"]}
              multiple={false}
              maxFileSize={104857600}
              minFileSize={0}
              clickable
            >
              <button type="button" className="btn btn-primary">
                Load firmware.bin
              </button>
            </Files>
          </div>
        ) : (
          <div>
            <div className="ota-loaded-chip">
              <br />
              <span>
                <strong>Loaded:</strong> {loadedFirmware.fileName}
              </span>
              <button
                type="button"
                className="ota-chip-remove"
                title="Remove the loaded firmware"
                disabled={runActive}
                onClick={clearFirmware}
              >
                <i className="fa fa-times" />
              </button>
            </div>
            <div className="ota-fw-info">
              <div>
                <strong>FW:</strong> {loadedFirmware.fwVer}
              </div>
              <div>
                <strong>Type:</strong> {loadedFirmware.deviceType}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  loadedFirmware: state.otaBatch.loadedFirmware,
  runActive: state.otaBatch.run.active
});

const mapDispatchToProps = (dispatch) => ({
  loadFirmwareFile: (file) => dispatch(actions.loadFirmwareFile(file)),
  clearFirmware: () => dispatch(actions.clearFirmware()),
  showAlert: (type, message) =>
    dispatch(alertActions.set({ type, message, autoClear: true }))
});

export default connect(mapStateToProps, mapDispatchToProps)(FwPanel);
