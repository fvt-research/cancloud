/*
 * Minio Cloud Storage (C) 2016, 2018 Minio, Inc.
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

import React from "react";
import { connect } from "react-redux";
import * as actionsBuckets from "../buckets/actions";

export class Host extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      nextBucketName: props.currentBucketName || ""
    };

    this.handleBucketChange = this.handleBucketChange.bind(this);
    this.handleBucketSubmit = this.handleBucketSubmit.bind(this);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.currentBucketName !== this.props.currentBucketName) {
      this.setState({ nextBucketName: this.props.currentBucketName || "" });
    }
  }

  componentDidMount() {
    if (!this.state.nextBucketName && this.props.currentBucketName) {
      this.setState({ nextBucketName: this.props.currentBucketName });
    }
  }

  handleBucketChange(event) {
    this.setState({ nextBucketName: event.target.value });
  }

  handleBucketSubmit(event) {
    event.preventDefault();
    const nextBucketName = this.state.nextBucketName.trim();

    if (!nextBucketName || nextBucketName === this.props.currentBucketName) {
      return;
    }

    this.props.switchS3Bucket(nextBucketName);
  }

  render() {
    const { endPoint, currentBucketName, s3buckets } = this.props;
    const bucketOptions = Array.from(
      new Set([
        ...(s3buckets || []),
        ...(currentBucketName ? [currentBucketName] : [])
      ])
    ).filter(Boolean);
    const controlStyle = {
      width: "100%",
      display: "block",
      boxSizing: "border-box",
      padding: "6px 8px",
      borderRadius: "4px",
      border: "1px solid #555",
      background: "#333",
      color: "#fff",
      fontSize: "12px"
    };

    return (
      <div>
        <div className="fes-host sb-custom">
          <span className="host-text sb-host-text">{endPoint}</span>
          <div
            style={{
              marginTop: "10px",
              width: "100%",
              boxSizing: "border-box",
              fontSize: "11px",
              color: "#aaa",
              marginBottom: "4px"
            }}
          >
            Current bucket:{" "}
            <strong style={{ color: "#fff" }}>
              {currentBucketName || "—"}
            </strong>
          </div>
          <form
            onSubmit={this.handleBucketSubmit}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              width: "100%",
              minWidth: 0
            }}
          >
            <select
              id="sidebarBucketName"
              name="sidebarBucketName"
              value={this.state.nextBucketName}
              onChange={this.handleBucketChange}
              style={{
                ...controlStyle,
                flex: 1,
                minWidth: 0,
                cursor: "pointer"
              }}
            >
              {bucketOptions.length === 0 && (
                <option value="">No buckets available</option>
              )}
              {bucketOptions.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {bucket}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                ...controlStyle,
                width: "auto",
                flex: "0 0 auto",
                background: "#444",
                whiteSpace: "nowrap",
                cursor: "pointer"
              }}
            >
              Switch bucket
            </button>
          </form>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  currentBucketName: state.buckets.bucketName,
  s3buckets: state.buckets.s3buckets,
});

const mapDispatchToProps = (dispatch) => ({
  switchS3Bucket: (bucketName) => dispatch(actionsBuckets.switchS3Bucket(bucketName)),
});

export default connect(mapStateToProps, mapDispatchToProps)(Host);
