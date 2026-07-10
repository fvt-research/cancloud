import React from "react";
import { connect } from "react-redux";
import Files from "react-files";

import * as actions from "./actions";
import * as alertActions from "../alert/actions";
import CollapsiblePreview from "./CollapsiblePreview";

// Top-left widget: the optional partial config loader. Styled like the
// encryption editor tool: small status/note/problem rows and a
// "Loaded: <file> x" chip. Device-specific warnings live in the table and the
// confirmation modal - only partial-level notes appear here.
export class LeftPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { previewOpen: false };
    this.fileReader = new FileReader();
    this.pendingFileName = "";

    this.fileReader.onload = (event) => {
      this.props.loadPartialFile(this.pendingFileName, event.target.result);
    };
  }

  onFileChange = (files) => {
    if (!files.length) return;
    this.pendingFileName = files[0].name;
    this.fileReader.readAsText(files[0]);
  };

  onFilesError = (error) => {
    this.props.showAlert("info", "Invalid file - " + error.message);
  };

  renderProblemRow(text, key) {
    return (
      <div className="red-text ota-status-row" key={key}>
        <i className="fa fa-times" /> {text}
      </div>
    );
  }

  renderNoteRow(text, key) {
    return (
      <div className="ota-status-row ota-note-row" key={key}>
        <i className="fa fa-info-circle" /> {text}
      </div>
    );
  }

  render() {
    const {
      partial,
      partialSource,
      partialBlockers,
      partialNotes,
      runActive,
      clearPartial
    } = this.props;

    const loaded = partial || partialBlockers.length > 0;
    const sourceLabel =
      partialSource && partialSource.kind === "editor"
        ? "partial from editor of " +
          (partialSource.deviceId || "?") +
          (partialSource.configName
            ? " (" + partialSource.configName + ")"
            : "")
        : (partialSource && partialSource.fileName) || "partial config";

    return (
      <div className="ota-left-panel">
        <span className="widget-title">Configure devices</span>
        <div className="ota-steps">
          <ol>
            <li>Load a full/partial Configuration File (or transfer from editor's review modal)</li>
            <li>Select devices to update from the table</li>
            <li>Review and submit</li>
          </ol>
        </div>

        {!loaded ? (
          <div className="file-dropzone" style={{ marginTop: "12px" }}>
            <Files
              onChange={this.onFileChange}
              onError={this.onFilesError}
              accepts={[".json"]}
              multiple={false}
              maxFileSize={10000000}
              minFileSize={0}
              clickable
            >
              <button type="button" className="btn btn-primary">
                Load partial config
              </button>
            </Files>
          </div>
        ) : (
          <div className="ota-loaded-chip"><br/>
            <span><strong>Loaded:</strong> {sourceLabel}</span>
            <button
              type="button"
              className="ota-chip-remove"
              title="Remove the loaded partial config"
              disabled={runActive}
              onClick={clearPartial}
            >
              <i className="fa fa-times" />
            </button>
          </div>
        )}

        {partialBlockers.map((message, index) =>
          this.renderProblemRow(message, "blocker" + index)
        )}
        {partialNotes.map((message, index) =>
          this.renderNoteRow(message, "note" + index)
        )}

        {partial && !partialBlockers.length ? (
          <CollapsiblePreview
            open={this.state.previewOpen}
            onToggle={() =>
              this.setState({ previewOpen: !this.state.previewOpen })
            }
            data={partial}
            label="Show partial config preview"
          />
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  partial: state.otaBatch.partial,
  partialSource: state.otaBatch.partialSource,
  partialBlockers: state.otaBatch.partialBlockers,
  partialNotes: state.otaBatch.partialNotes,
  runActive: state.otaBatch.run.active
});

const mapDispatchToProps = (dispatch) => ({
  loadPartialFile: (fileName, text) =>
    dispatch(actions.loadPartialFile(fileName, text)),
  clearPartial: () => dispatch(actions.clearPartial()),
  showAlert: (type, message) =>
    dispatch(alertActions.set({ type, message, autoClear: true }))
});

export default connect(mapStateToProps, mapDispatchToProps)(LeftPanel);
