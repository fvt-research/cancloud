import React from "react";
import { encryptionFields } from "config-editor-tools";

// "encrypted" (all) / "plain" (none) / "mixed" / "none" (no password sections)
export const classifyCurrentEncryption = (config) => {
  const sections = encryptionFields.analyzeConfigEncryption(config).sections;
  if (!sections.length) return "none";
  const encrypted = sections.filter((s) => s.keyformat === 1).length;
  if (encrypted === 0) return "plain";
  if (encrypted === sections.length) return "encrypted";
  return "mixed";
};

const LOCK_TITLES = {
  encrypted: "All passwords are currently encrypted",
  plain: "No passwords are encrypted (all plain-text)",
  mixed: "Mixed - some passwords encrypted, some plain-text",
  none: "No passwords in this Configuration File"
};
const LOCK_ICON = {
  encrypted: "fa-lock",
  plain: "fa-unlock",
  mixed: "fa-lock",
  none: "fa-lock"
};

export const renderEncryptionLock = (status) => {
  if (!status) return null;
  return (
    <i
      className={
        "fa " + (LOCK_ICON[status] || "fa-lock") + " ota-lock ota-lock-" + status
      }
      title={LOCK_TITLES[status] || ""}
    />
  );
};
