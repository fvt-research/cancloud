import React from "react";
import { connect } from "react-redux";
import * as actionsAlert from "../alert/actions";
import AlertContainer from "../alert/AlertContainer";
import history from "../history";
import { pathSlice } from "../utils";
import web from "../web";


// import editor and tools
import {EditorSection, OBDTool, FilterBuilderTool} from "config-editor-base";
import {
  EncryptionModal,
  FilterModal,
  BitRateModal,
  MigrationModal,
} from "config-editor-tools";

// import other modals
import DeviceFileModal from "../browser/DeviceFileModal"
import SideBar from "../browser/SideBar";
import MobileHeader from "../browser/MobileHeader";
import Header from "../browser/Header";

// import S3 actions
import * as actionsEditorS3 from "./actions";
import * as actionsBuckets from "../buckets/actions";
import * as actionsOtaBatch from "../otaBatch/actions";

// define UIschema and Rule Schema names for auto-loading purposes
export const uiSchemaAry = [
  // "uischema-01.06.json | Simple",
  // "uischema-01.06.json | Advanced",
  // "uischema-01.07.json | Simple",
  // "uischema-01.07.json | Advanced",
  // "uischema-01.08.json | Simple",
  // "uischema-01.08.json | Advanced",
  "uischema-01.09.json | Simple",
  "uischema-01.09.json | Advanced"
];

export const schemaAry = [
  "schema-01.06.json | CANedge2",
  "schema-01.06.json | CANedge1",
  "schema-01.07.json | CANedge2",
  "schema-01.07.json | CANedge1",
  "schema-01.07.json | CANedge3 GNSS",
  "schema-01.07.json | CANedge2 GNSS",
  "schema-01.07.json | CANedge1 GNSS",
  "schema-01.08.json | CANedge2",
  "schema-01.08.json | CANedge1",
  "schema-01.08.json | CANedge3 GNSS",
  "schema-01.08.json | CANedge2 GNSS",
  "schema-01.08.json | CANedge1 GNSS",
  "schema-01.09.json | CANedge2",
  "schema-01.09.json | CANedge1",
  "schema-01.09.json | CANedge3 GNSS",
  "schema-01.09.json | CANedge2 GNSS",
  "schema-01.09.json | CANedge1 GNSS"
];


export const demoMode = false 

class Editor extends React.Component {
  UNSAFE_componentWillMount() {
    const { bucket, prefix } = pathSlice(history.location.pathname);
    this.props.fetchFilesS3(prefix);
  }

  componentDidUpdate(prevProps) {
    // react to the ROUTE device changing - covers the sidebar "Configure"
    // switch AND direct URL (hash) edits. The previous currentBucket-based
    // trigger missed hash-only navigation, leaving the old device's editor
    // state active under the new device's URL
    const prevDevice = prevProps.match && prevProps.match.params.device;
    const curDevice = this.props.match && this.props.match.params.device;

    if (curDevice && curDevice !== prevDevice) {
      // sets currentBucket + fetches the device.json (skipped when the
      // sidebar dropdown already did it)
      if (this.props.currentBucket !== curDevice) {
        this.props.selectBucket(curDevice);
      }
      this.props.fetchFilesS3(curDevice);
    }
  }

  // return the device.json for auto-load in the encryption tool - ONLY when
  // it provably belongs to the device being configured. Any gate failing
  // returns undefined and the tool falls back to manual device.json upload.
  // Note: a cfg_crc32 mismatch does NOT block - the tool itself shows the
  // non-blocking checksum warning, exactly as with a manual upload
  getValidatedDeviceFile() {
    const { deviceFileContent, editorConfigFiles } = this.props;
    const { prefix } = pathSlice(history.location.pathname);

    if (!deviceFileContent || !prefix) {
      return undefined;
    }

    // the device.json's own id must match the device folder being edited
    // (race-proof: a stale device.json from a previously selected device can
    // never pass while the route points at another device)
    if (deviceFileContent.id !== prefix) {
      return undefined;
    }

    // the loaded config must be the device's active config file
    const configFileName =
      editorConfigFiles && editorConfigFiles[0] && editorConfigFiles[0].name;
    if (!configFileName || deviceFileContent.cfg_name !== configFileName) {
      return undefined;
    }

    if (
      typeof deviceFileContent.kpub !== "string" ||
      deviceFileContent.kpub.length !== 88
    ) {
      return undefined;
    }

    return deviceFileContent;
  }

  render() {
    let editorTools = [
      {
        name: "migration-modal",
        comment: "Migrate Configuration File",
        class: "fa fa-arrow-circle-up",
        modal: (
          <MigrationModal
            showAlert={this.props.showAlert}
            schemaAry={schemaAry}
            uiSchemaAry={uiSchemaAry}
          />
        ),
      },
      {
        name: "obd-modal",
        comment: "OBD tool",
        class: "fa fa-car",
        modal: <OBDTool showAlert={this.props.showAlert} />,
      },
      {
        name: "filter-builder-modal",
        comment: "Filter builder",
        class: "fa fa-sliders",
        modal: <FilterBuilderTool showAlert={this.props.showAlert} deviceType="CANedge" />,
      },
      {
        name: "encryption-modal",
        comment: "Encryption tool",
        class: "fa fa-lock",
        modal: (
          <EncryptionModal
            showAlert={this.props.showAlert}
            deviceFileContent={this.getValidatedDeviceFile()}
          />
        ),
      },
      {
        name: "filter-modal",
        comment: "Filter checker",
        class: "fa fa-filter",
        modal: <FilterModal showAlert={this.props.showAlert} />,
      },
      {
        name: "bitrate-modal",
        comment: "Bit-time calculator",
        class: "fa fa-calculator",
        modal: <BitRateModal showAlert={this.props.showAlert} />,
      }
    ];

    return (
      <div className="file-explorer">
        <SideBar />
        <div className="fe-body">
        <AlertContainer />

          {web.LoggedIn() && <MobileHeader />}
          <Header />

          <DeviceFileModal/>

          <EditorSection
            editorTools={editorTools}
            showAlert={this.props.showAlert}
            sideBarPadding={true}
            uiSchemaAry={uiSchemaAry}
            schemaAry={schemaAry}
            demoMode={demoMode}
            fetchFileContentExt={this.props.fetchFileContentS3}
            updateConfigFileExt={this.props.updateConfigFileS3}
            onTransferPartial={this.props.transferPartialToOta}
          />
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state, ownProps) => {
  return {
    currentBucket: state.buckets.currentBucket,
    deviceFileContent: state.browser.deviceFileContent,
    editorConfigFiles: state.editor.editorConfigFiles,
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    showAlert: (type, message) =>
      dispatch(actionsAlert.set({ type: type, message: message })),
    selectBucket: (bucket) => dispatch(actionsBuckets.selectBucket(bucket)),
    fetchFilesS3: (prefix) => dispatch(actionsEditorS3.fetchFilesS3(prefix)),
    fetchFileContentS3: (prefix,type) => dispatch(actionsEditorS3.fetchFileContentS3(prefix,type)),
    updateConfigFileS3: (content, object) => dispatch(actionsEditorS3.updateConfigFileS3(content, object)),
    transferPartialToOta: (payload) => dispatch(actionsOtaBatch.receivePartialFromEditor(payload))
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(Editor);
