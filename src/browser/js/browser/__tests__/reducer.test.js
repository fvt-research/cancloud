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

import reducer from "../reducer"
import * as actionsCommon from "../actions"

describe("common reducer", () => {
  it("should return the initial state", () => {
    expect(reducer(undefined, {})).toEqual({
      sidebarOpen: false,
      objectName: "",
      deviceImage: undefined,
      prevDeviceFileDevice: "",
      deviceFileContent: {},
      deviceFileLastModified: "",
      deviceFileTableOpen: false
    })
  })

  it("should handle TOGGLE_SIDEBAR", () => {
    expect(
      reducer(
        { sidebarOpen: false },
        {
          type: actionsCommon.TOGGLE_SIDEBAR
        }
      )
    ).toEqual({
      sidebarOpen: true
    })
  })

  it("should handle SET_DEVICE_IMAGE", () => {
    expect(
      reducer(undefined, {
        type: actionsCommon.SET_DEVICE_IMAGE,
        deviceImage: "https://example.test/img.png"
      }).deviceImage
    ).toEqual("https://example.test/img.png")
  })

  it("should handle SET_DEVICE_FILE_DATA", () => {
    expect(
      reducer(undefined, {
        type: actionsCommon.SET_DEVICE_FILE_DATA,
        deviceFileContent: { id: "AABBCCDD" }
      }).deviceFileContent
    ).toEqual({ id: "AABBCCDD" })
  })

  it("should handle TOGGLE_DEVICE_FILE_TABLE", () => {
    expect(
      reducer(
        { deviceFileTableOpen: false },
        {
          type: actionsCommon.TOGGLE_DEVICE_FILE_TABLE
        }
      ).deviceFileTableOpen
    ).toBe(true)
  })
})
