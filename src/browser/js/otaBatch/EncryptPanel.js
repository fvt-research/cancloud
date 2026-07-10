import React from "react";
import { connect } from "react-redux";
import { encryptionCrypto } from "config-editor-tools";

import * as actions from "./actions";
import { getEncryptEnablement, getEncryptActive } from "./selectors";

// Bottom-left widget: the optional "Encrypt passwords" control. Encryption is
// evaluated on the POST-merge config; the checkbox is enabled only when every
// selected device is compatible and at least one has plain-text passwords.
export class EncryptPanel extends React.Component {
  render() {
    const { encryptActive, enablement, runActive, setEncryptPasswords } =
      this.props;

    const browserError = encryptionCrypto.checkBrowserSupport();
    const disabled = runActive || !!browserError || !enablement.enabled;
    // shown on hover when the checkbox is greyed out (kept out of the layout so
    // it never shifts the checkbox position)
    const disabledReason = browserError
      ? browserError
      : runActive
      ? "A batch submission is in progress"
      : enablement.reason || "";

    return (
      <div className="ota-left-panel ota-encrypt-panel">
        <span className="widget-title">Encrypt passwords</span>
        <div className="ota-steps">
          <p>
            Encrypt all passwords for each selected device
          </p>
        </div>

        <label
          className={
            "checkbox-design ota-encrypt-checkbox" +
            (disabled ? " is-disabled" : "")
          }
          title={disabled ? disabledReason : ""}
        >
          <input
            type="checkbox"
            checked={encryptActive}
            disabled={disabled}
            onChange={(e) => setEncryptPasswords(e.target.checked)}
          />
          <span>Encrypt passwords for selection</span>
        </label>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  encryptActive: getEncryptActive(state),
  enablement: getEncryptEnablement(state),
  runActive: state.otaBatch.run.active
});

const mapDispatchToProps = (dispatch) => ({
  setEncryptPasswords: (value) => dispatch(actions.setEncryptPasswords(value))
});

export default connect(mapStateToProps, mapDispatchToProps)(EncryptPanel);
