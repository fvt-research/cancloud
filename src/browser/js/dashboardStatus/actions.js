import web from "../web";
import * as alertActions from "../alert/actions";
import * as bucketActions from "../buckets/actions";
import _ from "lodash";
import { demoMode } from "../utils";
import load from "jszip/lib/load";
import { isValidLogfile } from "../utils";
import { statusRequestQueue } from "../requestQueue";
import { classifyCurrentEncryption } from "../encryptionLock";

export const SET_PERIODSTART_BACK = "dashboardStatus/SET_PERIODSTART_BACK";
export const SET_OBJECTS_DATA = "dashboardStatus/SET_OBJECTS_DATA";
export const ADD_DEVICE_MARKER = "dashboardStatus/ADD_DEVICE_MARKER";
export const SET_LAST_OBJECT_DATA = "dashboardStatus/SET_LAST_OBJECT_DATA";
export const SET_OBJECTS_DATA_MIN = "dashboardStatus/SET_OBJECTS_DATA_MIN";
export const DEVICE_FILE_CONTENT = "dashboardStatus/DEVICE_FILE_CONTENT";
export const SET_DEVICE_FILE_OBJECT = "dashboardStatus/SET_DEVICE_FILE_OBJECT";
export const SET_CONFIG_OBJECTS = "dashboardStatus/SET_CONFIG_OBJECTS";
export const CONFIG_FILE_CONTENT = "dashboardStatus/CONFIG_FILE_CONTENT";
export const SET_CONFIG_FILE_CRC32 = "dashboardStatus/SET_CONFIG_FILE_CRC32";
export const SET_DEVICE_ENC_STATUS = "dashboardStatus/SET_DEVICE_ENC_STATUS";
export const SET_UPLOADED_SIZE_TOTAL =
  "dashboardStatus/SET_UPLOADED_SIZE_TOTAL";
export const LOADED_FILES = "dashboardStatus/LOADED_FILES";
export const LOADED_CONFIG = "dashboardStatus/LOADED_CONFIG";
export const LOADED_DEVICE = "dashboardStatus/LOADED_DEVICE";
export const CLEAR_DATA_DEVICES = "dashboardStatus/CLEAR_DATA_DEVICES";
export const CLEAR_DATA_FILES = "dashboardStatus/CLEAR_DATA_FILES";
export const SET_DEVICES_FILES_COUNT =
  "dashboardStatus/SET_DEVICES_FILES_COUNT";

import speedDate from "speed-date";
import { crc32 } from "crc";

const loggerRegex = new RegExp(/([0-9A-Fa-f]){8}/);
const loggerConfigRegex = new RegExp(
  /^([0-9A-Fa-f]){8}\/config-[0-9]{2}.[0-9]{2}.json/,
  "g"
);

let lastHour = new Date();
lastHour.setTime(lastHour.getTime() - 1 * 60 * 60 * 1000);

// list objects for devices (device.json and config-XX.YY.json)
export const listAllObjects = (devicesDevicesInput, options = {}) => {
  return function(dispatch, getState) {
    const loadLogFiles = options.loadLogFiles !== false;

    return web.ListBuckets().then(res => {
      let devices = res.buckets ? res.buckets.map(bucket => bucket.name) : [];
      devices = devices.filter(e => e.match(loggerRegex));

      // list devices selected in the status dashboard dropdown - or list all devices as default
      let devicesDevices = devicesDevicesInput
        ? devicesDevicesInput.length
          ? devicesDevicesInput
          : []
        : devices;

      // if no devices are found, set loaded to true for Device File and Configuration File
      if (devicesDevices.length == 0) {
        dispatch(loadedDevice(true));
        dispatch(loadedConfig(true));
      }

      // else, fetch the Device File of each device - the heartbeat (lastModified) is read
      // from the GET response headers, so no separate HEAD requests are needed
      if (!getState().dashboardStatus.loadedDevice) {
        dispatch(
          fetchDeviceFileContentAll(
            devicesDevices.map(device => ({ deviceId: device }))
          )
        ).then(deviceFileObjectsAry => {
          dispatch(setDeviceFileObjects(deviceFileObjectsAry));
          dispatch(loadedDevice(true));
          dispatch(listConfigFiles(deviceFileObjectsAry, devicesDevicesInput, loadLogFiles));
        });
      } else if (
        !getState().dashboardStatus.loadedConfig ||
        !getState().dashboardStatus.loadedFiles
      ) {
        dispatch(listConfigFiles([], devicesDevicesInput, loadLogFiles));
      }
    });
  };
};

export const listConfigFiles = (deviceFileObjectsAry, devicesDevicesInput, loadLogFiles = true) => {

  return function(dispatch, getState) {
    let configObjectsUnique = []

    deviceFileObjectsAry.map((device) => {
      let deviceFileContent = getState().dashboardStatus.deviceFileContents.filter(e => e && e.id == device.deviceId)[0]
      if (deviceFileContent && deviceFileContent.cfg_name) {
        configObjectsUnique.push({deviceId: device.deviceId, name: device.deviceId+"/"+deviceFileContent.cfg_name})
      }
    })

    dispatch(setConfigObjects(configObjectsUnique));
    dispatch(fetchConfigFileContentAll(configObjectsUnique));
    dispatch(loadedConfig(true));

    // note: Once the device specific info is loaded, initiate the load of the log file specific data
    // this is done as a default operation only for the case where no devicesDevicesInput is parsed
    // i.e. when the user opens the status dashboard from the menu or clicking "update" with no selection
    if (loadLogFiles && devicesDevicesInput == undefined) {
      dispatch(listLogFiles());
    }
  }
};

// list objects for log files for use in status dashboard

export const listLogFiles = devicesFilesInput => {
  return function(dispatch, getState) {
    let devices = getState().buckets.list ? getState().buckets.list : [];
    devices = devices.filter(e => e.match(loggerRegex));
    const devicesFilesDefaultMax = demoMode ? 15 : 10;

    // if the user selects specific devices (devicesFilesInput) show these. If no selection, show up to X devices by default
    let devicesFiles =
      devicesFilesInput != undefined && devicesFilesInput.length != 0
        ? devicesFilesInput
        : devices.length <= devicesFilesDefaultMax
        ? devices
        : [];

    // if no devices for files, set loaded to true
    if (devicesFiles.length == 0) {
      dispatch(loadedFiles(true));
    }

    // identify log file markers (for speed optimization) and then load log file meta data
    dispatch(identifyLogFileMarkers(devicesFiles));
  };
};

// first object of a session ({name, lastModified}) or null if empty, via a tiny
// prefix-scoped listing (no arbitrary-key positioning, so Azure gateways work too)
const probeSessionFirstObject = sessionPrefixName =>
  statusRequestQueue
    .add(() =>
      web.ListObjectsRecursivePage({
        bucketName: "Home",
        prefix: sessionPrefixName,
        continuationToken: "",
        maxKeys: 1
      })
    )
    .then(res => (res.objects && res.objects[0] ? res.objects[0] : null));

// find a listing 'marker' for a device so processLogFiles only lists objects uploaded
// around/after periodStart: one delimiter listing of the session folders, then a single
// parallel wave of tiny probes across up to 8 sessions (always the first and last, plus
// evenly spaced ones). The marker is approximate on the conservative (early) side -
// exactly like the previous depth-limited binary search, but in 1 round-trip wave
// instead of up to 5 sequential full-page session listings
const findDeviceMarker = (device, periodStart) => {
  return web
    .ListObjects({
      bucketName: "Home",
      prefix: device + "/"
    })
    .then(data => {
      // Remove non-session folders from search
      let sessions = data.objects.filter(obj => obj.name.endsWith("/"));

      // if the device has no data, SKIP:
      if (sessions.length == 0) {
        return { deviceId: device, marker: "SKIP" };
      }

      const maxProbes = Math.min(8, sessions.length);
      const probeIndexes = [
        ...new Set(
          Array.from({ length: maxProbes }, (unused, i) =>
            Math.round((i * (sessions.length - 1)) / (maxProbes - 1 || 1))
          )
        )
      ];

      return Promise.all(
        probeIndexes.map(index =>
          probeSessionFirstObject(sessions[index].name).catch(e => null)
        )
      ).then(probedObjects => {
        const validProbes = probedObjects.filter(obj => obj != null);
        if (validProbes.length == 0) {
          return { deviceId: device, marker: "SKIP" };
        }

        // if even the first session starts within the period, load everything
        if (validProbes[0].lastModified > periodStart) {
          return { deviceId: device, marker: "" };
        }

        // else start listing from the latest probed session that begins before
        // periodStart - sessions in between are included conservatively
        const markerObject = validProbes.filter(
          obj => obj.lastModified < periodStart
        ).slice(-1)[0];

        return { deviceId: device, marker: markerObject ? markerObject.name : "" };
      });
    });
};

export const identifyLogFileMarkers = devicesFiles => {
  return function(dispatch, getState) {
    if (devicesFiles.length == 0) {
      return;
    }
    let periodStart = getState().dashboardStatus.periodStart;

    // probe start-after support (Azure gateways reject it) in parallel with marker
    // discovery; when unsupported, processLogFiles lists in full instead of skipping
    Promise.all([
      web.ProbeStartAfterSupport().then(res => !!res.supported).catch(() => false),
      Promise.all(
        devicesFiles.map(device =>
          findDeviceMarker(device, periodStart).catch(e => ({
            deviceId: device,
            marker: "SKIP"
          }))
        )
      )
    ]).then(([startAfterSupported, logFileMarkers]) => {
      // log which listing path is used (on Azure the probe above 501s once, expected)
      console.info(
        startAfterSupported
          ? "Status dashboard: S3 start-after supported - using optimal marker-based listing"
          : "Status dashboard: S3 start-after NOT supported (Azure/Flexify) - falling back to full per-device listing"
      );
      logFileMarkers.map(logFileMarker => dispatch(addDeviceMarker(logFileMarker)));
      dispatch(processLogFiles(devicesFiles, logFileMarkers, startAfterSupported));
    });
  };
};

export const processLogFiles = (devicesFiles, logFileMarkers, startAfterSupported = true) => {
  let iCount = 0;

  let mf4ObjectsHourAry = [];
  let mf4ObjectsMinAry = [];
  let lastFileAry = [];
  let dateFormats = ["YYYY-MM-DD HH", "YYYY-MM-DD HH:mm"];

  return function(dispatch, getState) {
    let binPeriodStart = getState().dashboardStatus.periodStart;

    // start by initializing the device processed counter
    dispatch(setDevicesFilesCount(iCount));

    // load all log files recursively for each device in devicesFiles
    if (!getState().dashboardStatus.loadedFiles) {
      devicesFiles.map(device => {
        let marker = logFileMarkers.filter(e => e.deviceId == device)[0]
          ? logFileMarkers.filter(e => e.deviceId == device)[0].marker
          : "";
        if (marker == "SKIP") {
          iCount += 1;
          dispatch(setDevicesFilesCount(iCount));
          if (
            getState().dashboardStatus.devicesFilesCount == devicesFiles.length
          ) {
            dispatch(setDeviceLastMf4MetaData(lastFileAry));
            dispatch(setObjectsData(mf4ObjectsHourAry));
            dispatch(setObjectsDataMin(mf4ObjectsMinAry));
            dispatch(loadedFiles(true));
          }
        } else {
          // marker (start-after) skips old sessions; where unsupported (Azure) list
          // in full - the per-period binning below keeps results correct regardless
          const effectiveMarker = startAfterSupported ? marker : "";
          web
            .ListObjectsRecursive({
              bucketName: "Home",
              prefix: device + "/",
              marker: effectiveMarker
            })
            .then(data => {
              let validObjects = data.objects.filter(obj => isValidLogfile(obj.name.split(".").slice(-1)[0])); // include only log files
              iCount += 1;
              dispatch(setDevicesFilesCount(iCount));

              // extract the last uploaded log file for each device
              let lastFile = validObjects[validObjects.length - 1];

              if (lastFile) {
                lastFileAry = lastFileAry.concat(
                  validObjects[validObjects.length - 1]
                );
              }

              // Aggregate the loaded data information to either hourly or minute basis by mapping across dateFormats
              // First, data is aggregated to hourly basis for the full period since periodStart
              // After this, it is aggregated to minute basis for the lastHour
              dateFormats.map((format, index) => {
                let periodStartVar = index == 0 ? binPeriodStart : lastHour;
                let sizePerTime = {};

                // aggregate log file size
                sizePerTime = validObjects.reduce(
                  (acc, { lastModified, size }) => {
                    if (lastModified > periodStartVar) {
                      const lastModH = speedDate.cached(format, lastModified);

                      if (!acc) {
                        acc = {};
                      }

                      if (!acc[lastModH]) {
                        acc[lastModH] = 0;
                      }

                      acc[lastModH] =
                        Math.round(parseFloat(acc[lastModH] + size) * 100) /
                        100;
                      return acc;
                    }
                  },
                  {}
                );

                // aggregate log file count
                let countPerTime = validObjects.reduce(
                  (accCnt, { lastModified }) => {
                    if (lastModified > periodStartVar) {
                      const lastModH = speedDate.cached(format, lastModified);

                      if (!accCnt) {
                        accCnt = {};
                      }

                      if (!accCnt[lastModH]) {
                        accCnt[lastModH] = 0;
                      }

                      accCnt[lastModH] = parseInt(accCnt[lastModH] + 1);
                      return accCnt;
                    }
                  },
                  {}
                );

                // combine device log file data into an object structure for combining with data from other devices
                let dataPerTimeAry = [];
                if (sizePerTime) {
                  const periodStartVarFormat = speedDate(
                    format,
                    periodStartVar
                  );

                  Object.keys(sizePerTime).forEach(e => {
                    if (e > periodStartVarFormat) {
                      const deviceId = device;
                      const lastModified = e;
                      const size = sizePerTime[e] / (1024 * 1024);
                      const count = countPerTime[e];
                      dataPerTimeAry.push({
                        deviceId,
                        lastModified,
                        size,
                        count
                      });
                    }
                  });
                }

                if (index == 0) {
                  mf4ObjectsHourAry = mf4ObjectsHourAry.concat(dataPerTimeAry);
                } else {
                  mf4ObjectsMinAry = mf4ObjectsMinAry.concat(dataPerTimeAry);
                }
              });

              // when all devices are processed, dispatch the full data and set loadedFiles to true to display the data
              if (
                getState().dashboardStatus.devicesFilesCount ==
                devicesFiles.length
              ) {
                dispatch(setDeviceLastMf4MetaData(lastFileAry));
                dispatch(setObjectsData(mf4ObjectsHourAry));
                dispatch(setObjectsDataMin(mf4ObjectsMinAry));
                dispatch(loadedFiles(true));
              }
            });
        }
      });
    }
  };
};

// fetch the device.json content of each device via a single GET per device.
// The heartbeat timestamp (lastModified) is read from the GET response headers,
// making separate HEAD requests unnecessary. Returns a promise resolving to
// [{deviceId, lastModified}] for the devices that could be fetched
export const fetchDeviceFileContentAll = deviceFileObjects => {
  const expiry = 5 * 24 * 60 * 60 + 1 * 60 * 60 + 0 * 60;

  return function(dispatch, getState) {
    // a missing device.json (404) is a normal condition (e.g. a device folder
    // that has not connected yet) - log it and skip the device silently.
    // Only unexpected failures (network, 5xx, auth) alert the user, and only
    // ONCE per batch rather than once per failing device
    let unexpectedFailures = 0;
    return Promise.all(
      deviceFileObjects.map(deviceFileObject =>
        web
          .PresignedGet({
            bucket: deviceFileObject.deviceId,
            object: "device.json",
            expiry: expiry
          })
          .then(res => statusRequestQueue.add(() => fetch(res.url)))
          .then(r => {
            if (r.status == 404) {
              console.log(
                "No device.json found for " +
                  deviceFileObject.deviceId +
                  " - skipping"
              );
              return null;
            }
            if (!r.ok) {
              throw new Error("Failed to fetch device.json [" + r.status + "]");
            }
            const lastModified = new Date(r.headers.get("last-modified"));
            return r
              .json()
              .catch(e => {})
              .then(data => ({
                deviceId: deviceFileObject.deviceId,
                lastModified: lastModified,
                content: data
              }));
          })
          .catch(e => {
            console.error(
              "Failed to fetch device.json for " + deviceFileObject.deviceId,
              e
            );
            unexpectedFailures++;
            return null;
          })
      )
    ).then(results => {
      if (unexpectedFailures > 0) {
        dispatch(
          alertActions.set({
            type: "danger",
            message: "Failed to fetch information for some devices - try refreshing",
            autoClear: true
          })
        );
      }
      const loaded = results.filter(result => result != null);

      dispatch(
        deviceFileContent(
          loaded.map(result => result.content).filter(obj => obj != undefined)
        )
      );

      // add meta names to sidebar devices, but only during the initial page load
      let devices = getState().buckets.list.filter(e => e.match(loggerRegex));
      let loadAll = devices.length == deviceFileObjects.length;
      if (loadAll) {
        dispatch(bucketActions.addBucketMetaData());
      }

      // content is included so callers can associate a device.json with its
      // FOLDER id (deviceFileContents alone only allows matching by content.id,
      // which hides folder/id mismatches from e.g. cloned SD cards)
      return loaded.map(result => ({
        deviceId: result.deviceId,
        lastModified: result.lastModified,
        content: result.content
      }));
    });
  };
};

export const fetchConfigFileContentAll = configObjectsUnique => {
  const expiry = 5 * 24 * 60 * 60 + 1 * 60 * 60 + 0 * 60;

  return function(dispatch) {

    // clear configFileCrc32
    dispatch(setConfigFileCrc32([]));

    if (configObjectsUnique.length == 0) {
      return;
    }

    Promise.all(
      configObjectsUnique.map(configObject =>
        web
          .PresignedGet({
            bucket: configObject.deviceId,
            object: configObject.name.split("/")[1],
            expiry: expiry
          })
          .then(res => statusRequestQueue.add(() => fetch(res.url)))
          .then(r => r.text())
          .then(data => {
            const content = JSON.parse(data);
            return {
              content,
              crc32: {
                deviceId: configObject.deviceId,
                crc32: crc32(data)
                  .toString(16)
                  .toUpperCase()
                  .padStart(8, "0")
              },
              enc: {
                deviceId: configObject.deviceId,
                status: classifyCurrentEncryption(content)
              }
            };
          })
          .catch(e => {
            console.log("No valid config found");
            return {
              content: {},
              crc32: {
                deviceId: configObject.deviceId,
                crc32: "NA"
              },
              enc: { deviceId: configObject.deviceId, status: null }
            };
          })
      )
    ).then(results => {
      dispatch(configFileContent(results.map(result => result.content)));
      dispatch(setConfigFileCrc32(results.map(result => result.crc32)));
      dispatch(setDeviceEncStatus(results.map(result => result.enc)));
    });
  };
};

export const clearDataDevices = () => ({
  type: CLEAR_DATA_DEVICES
});

export const clearDataFiles = () => ({
  type: CLEAR_DATA_FILES
});

export const setObjectsData = mf4Objects => ({
  type: SET_OBJECTS_DATA,
  mf4Objects
});

export const setDeviceLastMf4MetaData = deviceLastMf4MetaData => ({
  type: SET_LAST_OBJECT_DATA,
  deviceLastMf4MetaData
});

export const setDevicesFilesCount = devicesFilesCount => ({
  type: SET_DEVICES_FILES_COUNT,
  devicesFilesCount
});

export const setObjectsDataMin = mf4ObjectsMin => ({
  type: SET_OBJECTS_DATA_MIN,
  mf4ObjectsMin
});

export const loadedFiles = loadedFiles => ({
  type: LOADED_FILES,
  loadedFiles
});

export const loadedDevice = loadedDevice => ({
  type: LOADED_DEVICE,
  loadedDevice
});

export const loadedConfig = loadedConfig => ({
  type: LOADED_CONFIG,
  loadedConfig
});

export const setConfigObjects = configObjectsUnique => ({
  type: SET_CONFIG_OBJECTS,
  configObjectsUnique
});

export const deviceFileContent = deviceFileContents => ({
  type: DEVICE_FILE_CONTENT,
  deviceFileContents
});

export const configFileContent = configFileContents => ({
  type: CONFIG_FILE_CONTENT,
  configFileContents
});

export const setConfigFileCrc32 = configFileCrc32 => ({
  type: SET_CONFIG_FILE_CRC32,
  configFileCrc32
});

export const setDeviceEncStatus = deviceEncStatus => ({
  type: SET_DEVICE_ENC_STATUS,
  deviceEncStatus
});

export const setDeviceFileObjects = deviceFileObjects => ({
  type: SET_DEVICE_FILE_OBJECT,
  deviceFileObjects
});

export const addDeviceMarker = logFileMarker => ({
  type: ADD_DEVICE_MARKER,
  logFileMarker
});

export const setPeriodStartBack = periodDelta => ({
  type: SET_PERIODSTART_BACK,
  periodDelta
});
