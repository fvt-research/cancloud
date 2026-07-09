import React from "react";
import { connect } from "react-redux";
import Moment from "moment";

import * as actions from "./actions";
import {
  getFilteredRows,
  getFilteredEligibleRows,
  getCounts,
  getMasterChecked
} from "./selectors";
import { RENDER_CAP } from "./constants";

// one table row; PureComponent keeps 1000-device fleets responsive
class DeviceRow extends React.PureComponent {
  renderStatus() {
    const { row } = this.props;
    const runState = row.runState;

    if (runState) {
      switch (runState.state) {
        case "queued":
          return <span className="grey-text">Queued</span>;
        case "submitting":
          return (
            <span className="ota-status-ready">
              <i className="fa fa-circle-o-notch fa-spin" /> Submitting
            </span>
          );
        case "submitted":
          return (
            <span className="ota-status-submitted" title={runState.message || ""}>
              <i className="fa fa-check" /> Submitted
            </span>
          );
        case "error":
          return (
            <span className="ota-status-error" title={runState.message || ""}>
              <i className="fa fa-times" /> Error
            </span>
          );
        case "aborted":
          return <span className="grey-text">Aborted</span>;
        default:
          break;
      }
    }

    const evaluation = row.evaluation;
    if (!evaluation || evaluation.status === "pending") {
      return <span className="grey-text">Evaluating ...</span>;
    }
    switch (evaluation.status) {
      case "blocked":
        return (
          <span className="grey-text" title={evaluation.reasons.join("\n")}>
            Incompatible
          </span>
        );
      case "unchanged":
        return (
          <span className="grey-text" title={evaluation.reasons.join("\n")}>
            {this.props.mode === "encryption" ? "Already encrypted" : "No change"}
          </span>
        );
      case "ready":
        return (
          <span className="ota-status-ready" title={evaluation.warnings.join("\n")}>
            Ready
            {evaluation.warnings.length ? (
              <span className="orange-text">
                {" "}
                <i className="fa fa-exclamation-triangle" />
                {evaluation.warnings.length}
              </span>
            ) : null}
          </span>
        );
      default:
        return null;
    }
  }

  render() {
    const { row, selected, runActive, onToggle, onDownload } = this.props;
    const eligible = row.evaluation && row.evaluation.status === "ready";
    const blocked = !eligible;

    const heartbeat = row.heartbeatMs ? Moment(row.heartbeatMs) : null;

    return (
      <tr className={blocked ? "ota-row-blocked" : ""}>
        <td>
          <input
            type="checkbox"
            checked={!!selected}
            disabled={!eligible || runActive}
            onChange={() => onToggle(row.id)}
          />
        </td>
        <td>{row.id}</td>
        <td>{row.type}</td>
        <td title={row.meta}>{row.meta}</td>
        <td>{heartbeat ? heartbeat.format("YY-MM-DD HH:mm") : ""}</td>
        <td>{heartbeat ? heartbeat.fromNow() : ""}</td>
        <td>{row.fwVer}</td>
        <td>
          {row.configSync.resolved && row.configSync.crc32 ? (
            row.configSync.synced ? (
              <span
                className="blue-text zero-bottom-margin"
                title={"CRC32: " + row.configSync.crc32}
              >
                <i className="fa fa-check" />{" "}
                <span className="grey-text">{row.configSync.crc32}</span>
              </span>
            ) : (
              <span
                className="red-text zero-bottom-margin"
                title={"CRC32: " + row.configSync.crc32}
              >
                <i className="fa fa-times" />{" "}
                <span className="grey-text">{row.configSync.crc32}</span>
              </span>
            )
          ) : null}
        </td>
        <td>
          {eligible ? (
            <a
              href=""
              className="ota-download-link"
              title={
                "Download the resulting config for this device" +
                (this.props.mode === "encryption"
                  ? " (preview - submission re-encrypts with a fresh key; structure and fields identical, ciphertexts differ)"
                  : " (byte-identical to what would be submitted)")
              }
              onClick={(e) => {
                e.preventDefault();
                onDownload(row.id);
              }}
            >
              <i className="fa fa-download" /> Download
            </a>
          ) : row.evaluation && row.evaluation.status === "unchanged" ? (
            <span className="grey-text">No change</span>
          ) : (
            <span className="grey-text">-</span>
          )}
        </td>
        <td>{this.renderStatus()}</td>
      </tr>
    );
  }
}

export class OtaDeviceTable extends React.Component {
  constructor(props) {
    super(props);
    this.state = { refreshing: false };
    this._mounted = true;
  }

  componentWillUnmount() {
    this._mounted = false;
  }

  onRefresh = () => {
    if (this.state.refreshing || this.props.runActive) return;
    this.setState({ refreshing: true });
    const done = () => {
      if (this._mounted) this.setState({ refreshing: false });
    };
    Promise.resolve(this.props.refresh()).then(done, done);
  };

  onMasterToggle = () => {
    const { masterChecked, filteredEligibleRows, selected, setSelection } =
      this.props;
    const next = { ...selected };
    if (masterChecked) {
      filteredEligibleRows.forEach((row) => delete next[row.id]);
    } else {
      filteredEligibleRows.forEach((row) => {
        next[row.id] = true;
      });
    }
    setSelection(next);
  };

  render() {
    const {
      filteredRows,
      filteredEligibleRows,
      counts,
      masterChecked,
      query,
      selected,
      runActive,
      setQuery,
      toggleSelect,
      downloadNewConfig,
      mode
    } = this.props;

    const rows = filteredRows.slice(0, RENDER_CAP);
    const capped = filteredRows.length > RENDER_CAP;

    return (
      <div className="ota-device-table">
        <div className="ota-table-controls">
          <input
            type="search"
            className="ota-search"
            placeholder="Search devices (ID or meta) ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="ota-counts">
            selected: {counts.selected} | in scope: {counts.inScope} | total:{" "}
            {counts.total}
          </span>
          <button
            type="button"
            className="ota-refresh-btn"
            title="Refresh device data (re-fetch device.json, config & schema from S3) - e.g. to confirm a device has adopted its new config before rolling out to the rest of the fleet"
            disabled={runActive || this.state.refreshing}
            onClick={this.onRefresh}
          >
            <i
              className={
                "fa fa-refresh" + (this.state.refreshing ? " fa-spin" : "")
              }
            />
          </button>
        </div>

        <div className="widget-table ota-table-scroll">
          <table className="table table-background">
            <thead className="widget-table-head">
              <tr>
                {/* fixed widths keep columns aligned across both tabs; Status
                    has no width so it flexes to fill the remaining space */}
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={masterChecked}
                    disabled={runActive || filteredEligibleRows.length === 0}
                    title={
                      masterChecked
                        ? "Deselect all eligible devices in scope"
                        : "Select all eligible devices in scope"
                    }
                    onChange={this.onMasterToggle}
                  />
                </th>
                <th style={{ width: 80 }}>Device ID</th>
                <th style={{ width: 54 }}>Type</th>
                <th style={{ width: 92 }}>Config meta</th>
                <th style={{ width: 108 }}>Last heartbeat</th>
                <th style={{ width: 100 }}>Heartbeat age</th>
                <th style={{ width: 72 }}>Firmware</th>
                <th style={{ width: 96 }}>Config synced</th>
                <th style={{ width: 96 }}>New config</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DeviceRow
                  key={row.id}
                  row={row}
                  mode={mode}
                  selected={selected[row.id]}
                  runActive={runActive}
                  onToggle={toggleSelect}
                  onDownload={downloadNewConfig}
                />
              ))}
            </tbody>
          </table>
          {capped ? (
            <p className="field-description">
              Showing the first {RENDER_CAP} of {filteredRows.length} matches -
              refine the search to narrow the list (selection still applies to
              all matches via the master checkbox)
            </p>
          ) : null}
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  filteredRows: getFilteredRows(state),
  filteredEligibleRows: getFilteredEligibleRows(state),
  counts: getCounts(state),
  masterChecked: getMasterChecked(state),
  query: state.otaBatch.query,
  selected: state.otaBatch.selected,
  runActive: state.otaBatch.run.active,
  mode: state.otaBatch.mode
});

const mapDispatchToProps = (dispatch) => ({
  setQuery: (query) => dispatch(actions.setQuery(query)),
  toggleSelect: (deviceId) => dispatch(actions.toggleSelect(deviceId)),
  setSelection: (selected) => dispatch(actions.setSelection(selected)),
  downloadNewConfig: (deviceId) => dispatch(actions.downloadNewConfig(deviceId)),
  refresh: () => dispatch(actions.refresh())
});

export default connect(mapStateToProps, mapDispatchToProps)(OtaDeviceTable);
