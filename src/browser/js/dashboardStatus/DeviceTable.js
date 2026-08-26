import React from "react";
import Moment from "moment";
import { canedgeTypeName } from "../utils";
import { renderEncryptionLock } from "../encryptionLock";
import SortableTh from "../SortableTh";
import { nextSort } from "../tableSort";
import { COLUMNS, sortRows } from "./rowSort";

// one cell; the bar-chart columns scale against the max across all devices
const renderCell = (key, v, maxDelta, maxUploaded) =>
  key == "sec" ? (
    renderEncryptionLock(v)
  ) : key == "time_since_heartbeat_min" ? (
    <ul className="chart">
      <li>
        <span
          style={{
            width: v ? (v / maxDelta) * 100 : 0,
            height: "100%",
            backgroundColor: "#46a5e0",
            color: v / maxDelta > 0.4 ? "white" : "#8e8e8e",
          }}
        >
          {v != undefined && !isNaN(v) ? (
            <div
              style={{
                marginLeft: v ? (v / maxDelta > 0.4 ? 0 : (v / maxDelta) * 100) : 0,
              }}
            >
              &nbsp;&nbsp;
              {v < 60
                ? Math.round(v) + "\u00A0" + "min"
                : v < 24 * 60
                ? Math.round((v / 60) * 10) / 10 + "\u00A0" + "hours"
                : Math.round((v / (60 * 24)) * 10) / 10 + "\u00A0" + "days"}
            </div>
          ) : (
            ""
          )}
        </span>
      </li>
    </ul>
  ) : key == "uploadedMb" ? (
    <ul className="chart">
      <li>
        <span
          style={{
            width: v ? v * 100 : 0,
            height: "100%",
            backgroundColor: "#46a5e0",
            color: v > 0.4 ? "white" : "#8e8e8e",
          }}
        >
          <div
            style={{
              marginLeft: v ? (v > 0.4 ? 0 : v * 100) : 0,
              whiteSpace: "nowrap",
            }}
          >
            &nbsp;{!isNaN(v) ? Math.round(v * maxUploaded) : ""}
            {v ? "\u00A0 MB" : null}
          </div>
        </span>
      </li>
    </ul>
  ) : key == "storageUsed" ? (
    <ul className="chart">
      <li>
        <span
          style={{
            width: v ? v : 0,
            height: "100",
            backgroundColor: "#FF9900",
            color: v > 40 ? "white" : "#8e8e8e",
          }}
        >
          {v != undefined && !isNaN(v) ? (
            <div style={{ marginLeft: v ? (v > 40 ? 0 : v) : 0 }}>
              &nbsp;&nbsp;{v}&nbsp;%
            </div>
          ) : (
            ""
          )}
        </span>
      </li>
    </ul>
  ) : key == "storageUsedAbs" ? (
    <span>{v != undefined ? v + " MB" : null}</span>
  ) : key == "configSync" ? (
    <div>
      {" "}
      {v.synced == true ? (
        <p className="blue-text zero-bottom-margin">
          <i className="fa fa-check" />{" "}
          <span className="grey-text">{v.crc32}</span>
        </p>
      ) : (
        <p className="red-text zero-bottom-margin">
          <i className="fa fa-times" />
        </p>
      )}
    </div>
  ) : (
    v
  );

class DeviceTable extends React.Component {
  // "id" ascending is the default order; kept while the table stays mounted
  state = { sortBy: "id", sortDesc: false };

  onSort = (key) =>
    this.setState((state) => nextSort(state.sortBy, state.sortDesc, key));

  render() {
    const {
      deviceIdListDeltaSort,
      deviceFileContents,
      mf4ObjectsFiltered,
      deviceCrc32Test,
      deviceEncStatus,
      height,
      deviceLastMf4MetaData,
    } = this.props;

    // return empty div if no devices to list
    if (
      deviceIdListDeltaSort == undefined ||
      deviceIdListDeltaSort.length == 0
    ) {
      return (
        <div>
          <p className="widget-no-data">No devices to list</p>
        </div>
      );
    }

    // aggregate uploaded data size by device
    const uploadedPerDevice = mf4ObjectsFiltered.reduce(
      (acc, { deviceId, size }) => {
        if (!acc[deviceId]) {
          acc[deviceId] = [];
        }
        acc[deviceId] = Math.round(parseFloat(acc[deviceId] + size) * 100) / 100;
        return acc;
      },
      {}
    );

    // identify the max size & delta (time since heartbeat) for use in the visual "bar charts" in table
    let maxUploaded = Math.max.apply(Math, Object.values(uploadedPerDevice));

    let maxDelta = Math.max.apply(
      Math,
      deviceIdListDeltaSort.map(function (o) {
        return o.lastModifiedDelta;
      })
    );

    const encByDevice = {};
    (deviceEncStatus || []).forEach((e) => {
      if (e) encByDevice[e.deviceId] = e.status;
    });

    // construct object containing all relevant table data per device
    const tableData = deviceIdListDeltaSort.map((e) => {
      // extract the device.json content related to the device
      const deviceFile = deviceFileContents.filter(
        (devFile) => devFile.id == e.deviceId
      )[0];

      // extract object with meta data on last log file uploaded for the device
      const lastMf4Meta = deviceLastMf4MetaData.filter(
        (meta) => meta.name.split("/")[0] == e.deviceId
      )[0];

      // calculate the delta time since last heartbeat
      const time_since_heartbeat_min = maxDelta
        ? Math.round(e.lastModifiedDelta * 100) / 100
        : 0;

      // extract the device ID and various properties from the device.json
      const id = e.deviceId;
      const type = canedgeTypeName(deviceFile && deviceFile.type);
      const meta = deviceFile && deviceFile.log_meta;
      const fwVer = deviceFile && deviceFile.fw_ver;
      const lastHeartbeat = e.lastModifiedMin;
      const uploadedMb =
        maxUploaded && uploadedPerDevice[e.deviceId]
          ? ((uploadedPerDevice[e.deviceId] / maxUploaded) * 100) / 100
          : NaN;
      const configSync = {
        synced:
          deviceCrc32Test[0] &&
          deviceCrc32Test.filter((obj) => obj.name == e.deviceId)[0] &&
          deviceCrc32Test.filter((obj) => obj.name == e.deviceId)[0].testCrc32,
        crc32: deviceFile && deviceFile.cfg_crc32,
      };

      let storageUsedAbs =
        deviceFile &&
        deviceFile.space_used_mb &&
        deviceFile.space_used_mb.replace("/", " / ");

      let storageUsed =
        deviceFile &&
        deviceFile.space_used_mb &&
        Math.round(
          (deviceFile.space_used_mb.split("/")[0] /
            deviceFile.space_used_mb.split("/")[1]) *
            10000
        ) / 100;
      storageUsed = storageUsed <= 100 ? storageUsed : undefined;
      let lastLogUpload = lastMf4Meta && lastMf4Meta.lastModified;
      lastLogUpload = lastLogUpload
        ? Moment(lastLogUpload).format("YY-MM-DD HH:mm")
        : "";

      return {
        id,
        type,
        meta,
        sec: encByDevice[id] || null,
        lastHeartbeat,
        time_since_heartbeat_min,
        storageUsed,
        storageUsedAbs,
        fwVer,
        configSync,
        lastLogUpload,
        uploadedMb,
        // not rendered - numeric sort keys for the formatted columns (rowSort.js)
        heartbeatDeltaMin: e.lastModifiedDelta,
        storageUsedMb: storageUsedAbs
          ? parseFloat(deviceFile.space_used_mb.split("/")[0])
          : undefined,
      };
    });

    const { sortBy, sortDesc } = this.state;
    const rows = sortRows(tableData, sortBy, sortDesc);

    const tableHeader = (
      <tr>
        {COLUMNS.map((column) => (
          <SortableTh
            key={column.key}
            column={column}
            className="widget-table-head"
            sortBy={sortBy}
            sortDesc={sortDesc}
            onSort={this.onSort}
          />
        ))}
      </tr>
    );

    const tableValues = rows.map((row) => (
      <tr key={row.id}>
        {COLUMNS.map((column) => (
          <td key={column.key}>
            {renderCell(column.key, row[column.key], maxDelta, maxUploaded)}
          </td>
        ))}
      </tr>
    ));

    return (
      <div className="widget-table" style={{ fontSize: "80%", height: height }}>
        <table className="table">
          <thead>{tableHeader}</thead>
          <tbody>{tableValues}</tbody>
        </table>
      </div>
    );
  }
}

export default DeviceTable;
