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

import configureStore from "redux-mock-store"
import thunk from "redux-thunk"
import * as actionsCommon from "../actions"

// The MinIO StorageInfo/ServerInfo actions were removed when CANcloud dropped the
// MinIO backend. These tests cover the current "common" (browser) action creators.

const middlewares = [thunk]
const mockStore = configureStore(middlewares)

describe("Common actions", () => {
  it("creates common/TOGGLE_SIDEBAR", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.toggleSidebar())
    expect(store.getActions()).toEqual([{ type: "common/TOGGLE_SIDEBAR" }])
  })

  it("creates common/CLOSE_SIDEBAR", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.closeSidebar())
    expect(store.getActions()).toEqual([{ type: "common/CLOSE_SIDEBAR" }])
  })

  it("creates common/SET_DEVICE_IMAGE", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.setDeviceImage("https://example.test/img.png"))
    expect(store.getActions()).toEqual([
      { type: "common/SET_DEVICE_IMAGE", deviceImage: "https://example.test/img.png" }
    ])
  })

  it("creates common/SET_DEVICE_FILE_DATA", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.setDeviceFileContent({ id: "AABBCCDD" }))
    expect(store.getActions()).toEqual([
      { type: "common/SET_DEVICE_FILE_DATA", deviceFileContent: { id: "AABBCCDD" } }
    ])
  })

  it("creates common/SET_PREV_DEVICE_FILE_DEVICE", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.setPrevDeviceFileDevice("AABBCCDD"))
    expect(store.getActions()).toEqual([
      { type: "common/SET_PREV_DEVICE_FILE_DEVICE", prevDeviceFileDevice: "AABBCCDD" }
    ])
  })

  it("creates common/SET_DEVICE_FILE_LAST_MODIFIED", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.setDeviceFileLastModified("January 1st 2026"))
    expect(store.getActions()).toEqual([
      { type: "common/SET_DEVICE_FILE_LAST_MODIFIED", deviceFileLastModified: "January 1st 2026" }
    ])
  })

  it("creates common/OPEN_DEVICE_FILE_TABLE", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.openDeviceFileTable())
    expect(store.getActions()).toEqual([{ type: "common/OPEN_DEVICE_FILE_TABLE" }])
  })

  it("creates common/TOGGLE_DEVICE_FILE_TABLE", () => {
    const store = mockStore()
    store.dispatch(actionsCommon.toggleDeviceFileTable())
    expect(store.getActions()).toEqual([{ type: "common/TOGGLE_DEVICE_FILE_TABLE" }])
  })
})
