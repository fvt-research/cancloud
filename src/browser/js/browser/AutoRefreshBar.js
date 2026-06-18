import React from "react";
import { connect } from "react-redux";
import history from "../history";
import * as objectsActions from "../objects/actions";
import * as dashboardStatusActions from "../dashboardStatus/actions";

const INTERVALS = [
  { label: "Off", value: 0 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
];

const R = 12;
const CIRCUMFERENCE = 2 * Math.PI * R; // ~75.4

const selectStyle = {
  background: "#333",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: "3px",
  fontSize: "11px",
  padding: "2px 4px",
  cursor: "pointer",
};

const btnStyle = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#fff",
  fontSize: "18px",
  padding: "0 4px",
  lineHeight: 1,
};

class AutoRefreshBar extends React.Component {
  constructor(props) {
    super(props);
    this.state = { interval: 0, remaining: 0 };
    this._timer = null;
  }

  componentWillUnmount() {
    this._stop();
  }

  _stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _start(interval) {
    this._stop();
    if (!interval) return;
    this.setState({ remaining: interval });
    this._timer = setInterval(() => {
      this.setState(({ remaining }) => {
        if (remaining <= 1) {
          this.props.onRefresh();
          return { remaining: interval };
        }
        return { remaining: remaining - 1 };
      });
    }, 1000);
  }

  onIntervalChange(e) {
    const interval = parseInt(e.target.value, 10);
    this.setState({ interval, remaining: interval });
    this._start(interval);
  }

  onManualRefresh() {
    this.props.onRefresh();
    if (this.state.interval > 0) {
      this.setState({ remaining: this.state.interval });
    }
  }

  render() {
    const { interval, remaining } = this.state;
    const progress = interval > 0 ? remaining / interval : 0;
    const dashoffset = CIRCUMFERENCE * (1 - progress);

    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <button
          onClick={this.onManualRefresh.bind(this)}
          title="Refresh now"
          style={btnStyle}
        >
          ↻
        </button>
        {interval > 0 && (
          <svg
            width="26"
            height="26"
            viewBox="0 0 30 30"
            title={`Next refresh in ${remaining}s`}
          >
            <circle
              cx="15" cy="15" r={R}
              fill="none" stroke="#555" strokeWidth="3"
            />
            <circle
              cx="15" cy="15" r={R}
              fill="none"
              stroke="#7bc67e"
              strokeWidth="3"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashoffset}
              strokeLinecap="round"
              transform="rotate(-90 15 15)"
              style={{ transition: "stroke-dashoffset 0.9s linear" }}
            />
            <text
              x="15" y="19"
              textAnchor="middle"
              fontSize="9"
              fill="#fff"
            >
              {remaining}
            </text>
          </svg>
        )}
        <select
          value={interval}
          onChange={this.onIntervalChange.bind(this)}
          style={selectStyle}
          title="Auto-refresh interval"
        >
          {INTERVALS.map(({ label, value }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch) => ({
  onRefresh() {
    const path = history.location.pathname;
    if (path.startsWith("/status-dashboard")) {
      // ponytail: clear then re-fetch; listAllObjects chains into listLogFiles automatically
      dispatch(dashboardStatusActions.clearDataDevices());
      dispatch(dashboardStatusActions.clearDataFiles());
      dispatch(dashboardStatusActions.listAllObjects());
    } else {
      dispatch(objectsActions.fetchObjects());
    }
  },
});

export default connect(null, mapDispatchToProps)(AutoRefreshBar);
