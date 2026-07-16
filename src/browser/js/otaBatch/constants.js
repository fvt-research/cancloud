import { encryptionFields } from "config-editor-tools";

// supported config revisions for batch operations - single source of truth
// with the device-by-device encryption tool
export const SUPPORTED_REVISIONS =
  encryptionFields.AUTO_ENCRYPTION_SUPPORTED_REVISIONS;

// anchored device folder test (stricter than the unanchored loggerRegex)
export const DEVICE_FOLDER_REGEX = /^[0-9A-Fa-f]{8}$/;

// object key whitelist asserted immediately before every batch config PUT
export const PUT_NAME_REGEX = /^[0-9A-Fa-f]{8}\/config-\d{2}\.\d{2}\.json$/;

// object key whitelist asserted immediately before every firmware PUT
export const FW_PUT_NAME_REGEX = /^[0-9A-Fa-f]{8}\/firmware\.bin$/;

// TLS certificate batch: the device only picks up this exact object name
export const TLS_FILE_NAME = "certs_server.p7b";

// object key whitelist asserted immediately before every certificate PUT
export const TLS_PUT_NAME_REGEX = /^[0-9A-Fa-f]{8}\/certs_server\.p7b$/;

// a 10-cert RSA-2048 bundle is ~20 KB - anything larger is a wrong file
export const TLS_MAX_FILE_SIZE = 262144;

// bounded concurrency for the batch submission run
export const SUBMIT_CONCURRENCY = 5;

// heartbeat older than this raises a non-blocking warning
export const STALE_HEARTBEAT_MS = 7 * 24 * 60 * 60 * 1000;

// soft cap on rendered table rows (matches remain selectable via search)
export const RENDER_CAP = 1000;

// presigned URL expiry used across the app (see editorNew/actions.js)
export const PRESIGN_EXPIRY = 5 * 24 * 60 * 60 + 1 * 60 * 60 + 0 * 60;
