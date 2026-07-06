/*
 * MinIO Cloud Storage (C) 2016, 2018 MinIO, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getCurrentBucket } from "../buckets/selectors";
import { getCurrentPrefix } from "../objects/selectors";
import { enqueueUpload, cancelUpload } from "./uploadEngine";

export const ADD = "uploads/ADD";
export const UPDATE_PROGRESS = "uploads/UPDATE_PROGRESS";
export const STOP = "uploads/STOP";
export const SHOW_ABORT_MODAL = "uploads/SHOW_ABORT_MODAL";

export const add = (slug, size, name) => ({
  type: ADD,
  slug,
  size,
  name
});

export const updateProgress = (slug, loaded) => ({
  type: UPDATE_PROGRESS,
  slug,
  loaded
});

export const stop = slug => ({
  type: STOP,
  slug
});

export const showAbortModal = () => ({
  type: SHOW_ABORT_MODAL,
  show: true
});

export const hideAbortModal = () => ({
  type: SHOW_ABORT_MODAL,
  show: false
});

export const abortUpload = slug => {
  return function(dispatch) {
    // cancels the queued or in-flight upload in the engine (no-op if unknown)
    cancelUpload(slug);
    dispatch(stop(slug));
    dispatch(hideAbortModal());
  };
};

export const uploadFile = file => {
  return function(dispatch, getState) {
    const state = getState();
    const currentBucket = getCurrentBucket(state) || "Home";
    const currentPrefix = getCurrentPrefix(state);
    enqueueUpload(dispatch, {
      bucketName: currentBucket,
      prefix: currentPrefix,
      file: file
    });
  };
};
