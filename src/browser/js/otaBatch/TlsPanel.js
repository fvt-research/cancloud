import React from "react";
import { connect } from "react-redux";
import Files from "react-files";

import * as actions from "./actions";
import * as alertActions from "../alert/actions";
import { TLS_FILE_NAME, TLS_MAX_FILE_SIZE } from "./constants";

// "Update TLS" tab widget: load one certs_server.p7b and deploy it to the
// selected device folders. The bundle is opaque to the tool (the device
// validates it) - only the exact file name and a sane size are enforced
// (see actions.loadTlsFile).
export class TlsPanel extends React.Component {
  onFileChange = (files) => {
    if (!files.length) return;
    this.props.loadTlsFile(files[0]);
  };

  onFilesError = (error) => {
    this.props.showAlert("info", "Invalid file - " + error.message);
  };

  render() {
    const { loadedTls, runActive, clearTls } = this.props;

    return (
      <div className="ota-left-panel ota-tls-panel">
        <span className="widget-title">Update TLS certificates</span>
        <div className="ota-steps">
          <ol>
            <li>Load the {TLS_FILE_NAME} TLS certificate you want to deploy</li>
            <li>Select devices to update from the table</li>
            <li>Review and submit</li>
          </ol>
        </div>

        {!loadedTls ? (
          <div className="file-dropzone" style={{ marginTop: "12px" }}>
            <Files
              onChange={this.onFileChange}
              onError={this.onFilesError}
              accepts={[".p7b"]}
              multiple={false}
              maxFileSize={TLS_MAX_FILE_SIZE}
              minFileSize={0}
              clickable
            >
              <button type="button" className="btn btn-primary">
                Load {TLS_FILE_NAME}
              </button>
            </Files>
          </div>
        ) : (
          <div>
            <div className="ota-loaded-chip">
              <br />
              <span>
                <strong>Loaded:</strong> {loadedTls.fileName}
              </span>
              <button
                type="button"
                className="ota-chip-remove"
                title="Remove the loaded certificate bundle"
                disabled={runActive}
                onClick={clearTls}
              >
                <i className="fa fa-times" />
              </button>
            </div>
            <p className="orange-text ota-panel-note">
              <i className="fa fa-exclamation-triangle" /> Devices must be able
              to connect to the server both before and after the update - during
              a certificate transition, include the current and the new server
              certificates in the bundle
            </p>
          </div>
        )}
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  loadedTls: state.otaBatch.loadedTls,
  runActive: state.otaBatch.run.active
});

const mapDispatchToProps = (dispatch) => ({
  loadTlsFile: (file) => dispatch(actions.loadTlsFile(file)),
  clearTls: () => dispatch(actions.clearTls()),
  showAlert: (type, message) =>
    dispatch(alertActions.set({ type, message, autoClear: true }))
});

export default connect(mapStateToProps, mapDispatchToProps)(TlsPanel);
