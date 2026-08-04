// Action type constants shared by actions.js, submitEngine.js and reducer.js
// (separate module so the submit engine does not import actions.js circularly)

export const SET_ENCRYPT_PASSWORDS = "otaBatch/SET_ENCRYPT_PASSWORDS";
export const SET_DEVICE_DATA = "otaBatch/SET_DEVICE_DATA";
export const SET_PARTIAL = "otaBatch/SET_PARTIAL";
export const CLEAR_PARTIAL = "otaBatch/CLEAR_PARTIAL";
export const SET_ARTIFACTS_REQUESTED = "otaBatch/SET_ARTIFACTS_REQUESTED";
export const PATCH_ARTIFACTS = "otaBatch/PATCH_ARTIFACTS";
export const SET_EVALUATIONS = "otaBatch/SET_EVALUATIONS";
export const SET_EVAL_PROGRESS = "otaBatch/SET_EVAL_PROGRESS";
export const BUMP_EVAL_TOKEN = "otaBatch/BUMP_EVAL_TOKEN";
export const SET_QUERY = "otaBatch/SET_QUERY";
export const SET_SORT = "otaBatch/SET_SORT";
export const TOGGLE_SELECT = "otaBatch/TOGGLE_SELECT";
export const SET_SELECTION = "otaBatch/SET_SELECTION";
export const SET_CONFIRM_OPEN = "otaBatch/SET_CONFIRM_OPEN";
export const SET_ACTIVE_TAB = "otaBatch/SET_ACTIVE_TAB";
export const SET_FIRMWARE = "otaBatch/SET_FIRMWARE";
export const CLEAR_FIRMWARE = "otaBatch/CLEAR_FIRMWARE";
export const SET_TLS = "otaBatch/SET_TLS";
export const CLEAR_TLS = "otaBatch/CLEAR_TLS";
export const RUN_START = "otaBatch/RUN_START";
export const RUN_APPEND = "otaBatch/RUN_APPEND";
export const RUN_DEVICE_STATUS = "otaBatch/RUN_DEVICE_STATUS";
export const RUN_DEVICE_STATUS_BATCH = "otaBatch/RUN_DEVICE_STATUS_BATCH";
export const RUN_ABORT_REQUESTED = "otaBatch/RUN_ABORT_REQUESTED";
export const RUN_DONE = "otaBatch/RUN_DONE";
export const RESET = "otaBatch/RESET";
