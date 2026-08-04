import React from "react";
import { connect } from "react-redux";
import Moment from "moment";

import * as actions from "./actions";
import {
  getSortedRows,
  getFilteredEligibleRows,
  getCounts,
  getMasterChecked,
  getLoadProgress
} from "./selectors";
import { RENDER_CAP } from "./constants";
import { renderEncryptionLock } from "../encryptionLock";

// key = the rowSort.js sort key (null -> not sortable); no width -> flexes.
// Every width is >= the header's own single-line need INCLUDING the sort caret
// (measured), so no header ever wraps to a second line; the sum plus Status'
// minimum is the table's min-width in otaBatch.less.
const COLUMNS = [
  { key: "id", label: "Device ID", width: 80 },
  { key: "type", label: "Type", width: 56 },
  { key: "meta", label: "Config meta", width: 92 },
  {
    key: "sec",
    label: "Sec",
    width: 46,
    title: "Current password encryption state"
  },
  { key: "heartbeat", label: "Last heartbeat", width: 104 },
  { key: "age", label: "Time since", width: 84 },
  { key: "fwVer", label: "Firmware", width: 78 },
  { key: "configSync", label: "Config sync", width: 94 },
  { key: null, label: "New config", width: 90 },
  { key: "status", label: "Status" }
];

const formatAge = (min) =>
  min < 60
    ? Math.round(min) + " min"
    : min < 24 * 60
    ? Math.round((min / 60) * 10) / 10 + " hours"
    : Math.round((min / (60 * 24)) * 10) / 10 + " days";

// one table row; PureComponent keeps 1000-device fleets responsive (nowMs is
// bucketed to the minute by the parent so it does not bust memoization)
class DeviceRow extends React.PureComponent {
  // full plain-text status (incl. reasons/warnings/messages) for the cell's
  // title tooltip - the Status column ellipsizes, so hovering must reveal it
  statusTitle() {
    const { row } = this.props;
    const runState = row.runState;
    if (runState) {
      const base =
        {
          queued: "Queued",
          submitting: "Submitting",
          submitted: "Submitted",
          error: "Error",
          aborted: "Aborted"
        }[runState.state] || "";
      return runState.message ? base + ": " + runState.message : base;
    }
    const display = row.display;
    if (!display || display.status === "pending") return "Evaluating ...";
    switch (display.status) {
      case "blocked":
        return (
          "Incompatible" +
          (display.reasons && display.reasons.length
            ? "\n" + display.reasons.join("\n")
            : "")
        );
      case "nochange":
        return "No change";
      case "ready":
        return (
          "Ready" +
          (display.warnings && display.warnings.length
            ? "\n" + display.warnings.join("\n")
            : "")
        );
      default:
        return "";
    }
  }

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
            <span className="ota-status-submitted">
              <i className="fa fa-check" /> Submitted
            </span>
          );
        case "error":
          return (
            <span className="ota-status-error">
              <i className="fa fa-times" /> Error
            </span>
          );
        case "aborted":
          return <span className="grey-text">Aborted</span>;
        default:
          break;
      }
    }

    const display = row.display;
    if (!display || display.status === "pending") {
      return <span className="grey-text">Evaluating ...</span>;
    }
    switch (display.status) {
      case "blocked":
        return <span className="grey-text">Incompatible</span>;
      case "nochange":
        return <span className="grey-text">No change</span>;
      case "ready":
        return (
          <span className="ota-status-ready">
            Ready
            {display.warnings.length ? (
              <span className="orange-text">
                {" "}
                <i className="fa fa-exclamation-triangle" />
                {display.warnings.length}
              </span>
            ) : null}
          </span>
        );
      default:
        return null;
    }
  }

  renderAgeBar() {
    const { row, nowMs, maxAgeMin } = this.props;
    if (!row.heartbeatMs) return "";
    // clamp: a device.json Last-Modified newer than our minute-bucketed "now"
    // would otherwise show a nonsensical negative age
    const ageMin = Math.max(0, (nowMs - row.heartbeatMs) / 60000);
    const ratio = maxAgeMin > 0 ? Math.max(0, Math.min(1, ageMin / maxAgeMin)) : 0;
    // identical bar geometry to the status dashboard (DeviceTable.js): px width
    // (0-100) inside the display:table .chart, label pushed just past the bar
    return (
      <ul className="chart">
        <li>
          <span
            style={{
              width: ratio ? ratio * 100 : 0,
              height: "100%",
              backgroundColor: "#46a5e0",
              color: ratio > 0.4 ? "white" : "#8e8e8e"
            }}
          >
            <div
              style={{
                marginLeft: ratio > 0.4 ? 0 : ratio * 100,
                whiteSpace: "nowrap"
              }}
            >
              &nbsp;&nbsp;{formatAge(ageMin)}
            </div>
          </span>
        </li>
      </ul>
    );
  }

  render() {
    const { row, selected, runActive, onToggle, onDownload } = this.props;
    const eligible = row.eligible;
    const display = row.display || {};

    const heartbeat = row.heartbeatMs ? Moment(row.heartbeatMs) : null;

    return (
      <tr className={eligible ? "" : "ota-row-blocked"}>
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
        <td className="ota-sec-cell">
          {renderEncryptionLock(row.currentEncStatus)}
        </td>
        <td>{heartbeat ? heartbeat.format("YY-MM-DD HH:mm") : ""}</td>
        <td>{this.renderAgeBar()}</td>
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
          {display.status === "ready" &&
          (display.willTls ||
            (display.willFirmware && !display.willMigrate)) ? (
            // TLS certificate push / patch-only firmware push: no config is written
            <span className="grey-text">No config change</span>
          ) : display.status === "ready" ? (
            <a
              href=""
              className="ota-download-link"
              title={
                "Download the resulting config for this device" +
                (display.willEncrypt
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
          ) : display.status === "nochange" ? (
            <span className="grey-text">No change</span>
          ) : (
            <span className="grey-text">-</span>
          )}
        </td>
        <td title={this.statusTitle()}>{this.renderStatus()}</td>
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

  renderHeader(column) {
    const { sortBy, sortDesc, toggleSort } = this.props;
    const style = column.width ? { width: column.width } : undefined;

    if (!column.key) {
      return (
        <th key={column.label} style={style}>
          {column.label}
        </th>
      );
    }

    const active = sortBy === column.key;
    const icon = active ? (sortDesc ? "fa-caret-down" : "fa-caret-up") : "fa-sort";
    return (
      <th
        key={column.key}
        style={style}
        className={"ota-sortable" + (active ? " ota-sorted" : "")}
        title={(column.title ? column.title + " - " : "") + "Sort by " + column.label}
        onClick={() => toggleSort(column.key)}
      >
        {column.label}
        <i className={"fa ota-sort-icon " + icon} />
      </th>
    );
  }

  render() {
    const {
      visibleRows,
      filteredEligibleRows,
      counts,
      masterChecked,
      query,
      selected,
      runActive,
      loadProgress,
      evalProgress,
      setQuery,
      toggleSelect,
      downloadNewConfig
    } = this.props;

    const rows = visibleRows.slice(0, RENDER_CAP);
    const capped = visibleRows.length > RENDER_CAP;

    // bucket "now" to the minute so age bars stay stable across re-renders
    // (preserves DeviceRow's PureComponent memoization)
    const nowMs = Math.floor(Date.now() / 60000) * 60000;
    let maxAgeMin = 0;
    visibleRows.forEach((r) => {
      if (r.heartbeatMs) {
        const a = (nowMs - r.heartbeatMs) / 60000;
        if (a > maxAgeMin) maxAgeMin = a;
      }
    });

    return (
      <div className="ota-device-table">
        <div className="ota-table-controls">
          <input
            type="search"
            className="ota-search"
            placeholder="Search devices (ID, meta, type, firmware, status) ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* say what the view is waiting for - on a large fleet the config
              fetch and the evaluation each take a while, and silent
              "Evaluating ..." rows look like a hang */}
          {loadProgress ? (
            <span className="ota-progress">
              <i className="fa fa-circle-o-notch fa-spin" /> Loading configs{" "}
              {loadProgress.done} / {loadProgress.total} ...
            </span>
          ) : evalProgress ? (
            <span className="ota-progress">
              <i className="fa fa-circle-o-notch fa-spin" /> Evaluating{" "}
              {evalProgress.done} / {evalProgress.total} devices ...
            </span>
          ) : null}

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
                {/* fixed widths keep columns aligned; Status has no width so it
                    flexes to fill the remaining space */}
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
                {COLUMNS.map((column) => this.renderHeader(column))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DeviceRow
                  key={row.id}
                  row={row}
                  nowMs={nowMs}
                  maxAgeMin={maxAgeMin}
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
  visibleRows: getSortedRows(state),
  filteredEligibleRows: getFilteredEligibleRows(state),
  counts: getCounts(state),
  masterChecked: getMasterChecked(state),
  query: state.otaBatch.query,
  sortBy: state.otaBatch.sortBy,
  sortDesc: state.otaBatch.sortDesc,
  selected: state.otaBatch.selected,
  runActive: state.otaBatch.run.active,
  loadProgress: getLoadProgress(state),
  evalProgress: state.otaBatch.evalProgress
});

const mapDispatchToProps = (dispatch) => ({
  setQuery: (query) => dispatch(actions.setQuery(query)),
  toggleSort: (sortBy) => dispatch(actions.toggleSort(sortBy)),
  toggleSelect: (deviceId) => dispatch(actions.toggleSelect(deviceId)),
  setSelection: (selected) => dispatch(actions.setSelection(selected)),
  downloadNewConfig: (deviceId) => dispatch(actions.downloadNewConfig(deviceId)),
  refresh: () => dispatch(actions.refresh())
});

export default connect(mapStateToProps, mapDispatchToProps)(OtaDeviceTable);
