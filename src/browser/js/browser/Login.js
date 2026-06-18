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
import logo from "../../img/logo.png";
import Alert from "../alert/Alert";
import * as actionsAlert from "../alert/actions";
import * as actionsBrowser from "./actions";
import InputGroup from "./InputGroup";
import web from "../web";
import { Redirect } from "react-router-dom";
import history from "../history";
import { demoMode } from "../utils";
import Files from "react-files";
const { detect } = require('detect-browser')
const browser = detect()

let news = "";

try {
  let newsJson = require("../../schema/news.json");
  news = newsJson.news;
} catch (err) { }

export class Login extends React.Component {
  constructor(props) {
    super(props);

    if (demoMode) {
      try {
        let demo = require("../../schema/demo-credentials.json");
        this.state = demo.demoCredentials;
      } catch (err) {
        this.state = {
          accessKey: "",
          secretKey: "",
          endPoint: "",
          region: "",
          bucketName: "",
          jsonFileName: "",
          fetchedBuckets: [],
          isFetchingBuckets: false,
        };
      }
    } else {
      this.state = {
        accessKey: "",
        secretKey: "",
        endPoint: "",
        region: "",
        bucketName: "",
        jsonFileName: "",
        fetchedBuckets: [],
        isFetchingBuckets: false,
      };
    }

    this.fileReader = new FileReader();

    this.fileReader.onload = (event) => {
      let cfg = JSON.parse(event.target.result);
      let cfgServer =
        cfg.connect && cfg.connect.s3 && cfg.connect.s3.server
          ? cfg.connect.s3.server
          : null;

      if (cfgServer != null) {
        let cfgKeyformat = cfgServer.keyformat;

        if (cfgKeyformat == 0) {
          let cfgEndpoint = cfgServer.endpoint ? cfgServer.endpoint : "";
          let cfgPort = cfgServer.port ? cfgServer.port : "";
          let cfgAccessKey = cfgServer.accesskey ? cfgServer.accesskey : "";
          let cfgSecretkey = cfgServer.secretkey ? cfgServer.secretkey : "";
          let cfgBucket = cfgServer.bucket ? cfgServer.bucket : "";
          let cfgRegion = cfgServer.region ? cfgServer.region : "";

          let endpoint = ""
          let cfgCloudEndPointTest = cfgEndpoint.substring(cfgEndpoint.length - 3) == "com" || cfgEndpoint.substring(cfgEndpoint.length - 3) == "net" || cfgEndpoint.substring(cfgEndpoint.length - 4) == "com/" || cfgEndpoint.substring(cfgEndpoint.length - 4) == "net/"

          if (cfgCloudEndPointTest) {
            endpoint = cfgEndpoint;
          } else {
            // assume MinIO case
            endpoint = cfgEndpoint + ":" + cfgPort;
          }

          try {
            this.setState({
              accessKey: cfgAccessKey,
              secretKey: cfgSecretkey,
              endPoint: endpoint,
              region: cfgRegion,
              bucketName: cfgBucket,

            }, () => {

            });
          } catch (e) {
            this.onFilesError(e);
          }
        } else {
          this.props.showAlert("info", "The S3 secretKey in the Configuration File appears to be encrypted. The S3 details have therefore not been loaded");
        }
      } else {
        this.props.showAlert("info", "Unable to identify S3 server details in the Configuration File");
      }
    };
  }

  onFileChange(file) {
    this.setState({ jsonFileName: file[0].name }, () => { });
  }

  configureGeneral(e) {
    e.preventDefault();
    history.push("/configuration");
  }

  // Handle field changes
  accessKeyChange(e) {
    this.setState({
      accessKey: e.target.value,
    });
  }

  secretKeyChange(e) {
    this.setState({
      secretKey: e.target.value,
    });
  }

  endPointChange(e) {
    this.setState({
      endPoint: e.target.value,
    });
  }

  regionChange(e) {
    this.setState({
      region: e.target.value,
    });
  }

  bucketNameChange(e) {
    this.setState({
      bucketName: e.target.value,
    });
  }

  fetchBuckets(event) {
    event.preventDefault();
    const { showAlert } = this.props;
    let endPointForFetch = this.state.endPoint;
    const isMinioServer = endPointForFetch
      .substring(endPointForFetch.length - 6)
      .includes(":");

    if (!this.state.accessKey || !this.state.secretKey || !this.state.endPoint) {
      showAlert(
        "danger",
        "Access Key, Secret Key and End Point are required to fetch buckets"
      );
      return;
    }

    if (
      endPointForFetch.substring(0, 5) == "http:" &&
      location.protocol == "https:" &&
      isMinioServer == false
    ) {
      endPointForFetch = endPointForFetch.replace("http://", "https://");
      this.setState({ endPoint: endPointForFetch });
      showAlert(
        "info",
        "Auto-adjusting endpoint prefix from http:// to https:// for bucket fetch"
      );
    } else if (
      endPointForFetch.substring(0, 5) == "http:" &&
      location.protocol == "https:"
    ) {
      showAlert(
        "danger",
        "A http:// server cannot be accessed via a https:// browser frontend. Replace https:// with http:// in the CANcloud URL of your browser and hit enter."
      );
      return;
    }

    if (
      endPointForFetch.substring(0, 5) != "http:" &&
      endPointForFetch.substring(0, 6) != "https:"
    ) {
      showAlert("danger", "Please add http:// or https:// in front of your endpoint");
      return;
    }

    this.setState({ isFetchingBuckets: true });

    fetch("/api/list-buckets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accessKey: this.state.accessKey,
        secretKey: this.state.secretKey,
        endPoint: endPointForFetch,
        region: this.state.region,
      })
    })
      .then((response) =>
        response.json().then((payload) => ({ ok: response.ok, payload }))
      )
      .then(({ ok, payload }) => {
        if (!ok) {
          const message = payload && payload.error ? payload.error : "Bucket fetch proxy failed";
          // ponytail: tag proxy errors so we don't fall through to misleading CORS message
          const err = new Error(message);
          err.fromProxy = true;
          throw err;
        }

        const fetchedBuckets = payload && payload.buckets ? payload.buckets : [];

        this.setState({
          fetchedBuckets,
          isFetchingBuckets: false,
          bucketName: fetchedBuckets.length === 1 ? fetchedBuckets[0] : "",
        });

        if (!fetchedBuckets.length) {
          showAlert("info", "No buckets were returned for these credentials");
        }
      })
      .catch((e) => {
        // If the proxy gave a real server-side error (e.g. AccessDenied), skip the
        // in-browser fallback — it won't help and would show a misleading CORS message.
        if (e && e.fromProxy) {
          this.setState({ isFetchingBuckets: false, fetchedBuckets: [] });
          const isAccessDenied = /AccessDenied|access denied|not authorized/i.test(e.message);
          if (isAccessDenied) {
            showAlert(
              "info",
              "Credentials lack s3:ListAllMyBuckets permission — enter bucket name directly below."
            );
          } else {
            showAlert("danger", `Bucket fetch failed: ${e.message}`);
          }
          return;
        }

        // Proxy unreachable — try in-browser as last resort
        web
          .listS3Buckets({
            accessKey: this.state.accessKey,
            secretKey: this.state.secretKey,
            endPoint: endPointForFetch,
            region: this.state.region,
            bucketName: this.state.bucketName,
          })
          .then((res) => {
            const fetchedBuckets = res.s3buckets
              ? res.s3buckets.map((bucket) => bucket.name || bucket)
              : [];

            this.setState({
              fetchedBuckets,
              isFetchingBuckets: false,
              bucketName: fetchedBuckets.length === 1 ? fetchedBuckets[0] : "",
            });

            if (!fetchedBuckets.length) {
              showAlert("info", "No buckets were returned for these credentials");
            }
          })
          .catch((fallbackError) => {
            this.setState({ isFetchingBuckets: false, fetchedBuckets: [] });
            const diagnosticContext = {
              pageProtocol: location.protocol,
              browser: browser && browser.name ? browser.name : "unknown",
              endpoint: endPointForFetch,
              region: this.state.region || "",
              hasAccessKey: !!this.state.accessKey,
              hasSecretKey: !!this.state.secretKey,
              selectedBucket: this.state.bucketName || ""
            };

            console.log("Fetch buckets diagnostic context:", diagnosticContext);
            console.log("Fetch buckets proxy error:", e);
            console.log("Fetch buckets fallback error:", fallbackError);

            const proxyErrorMessage = e && e.message ? e.message : "";
            const isProxyCertIssue = /unable to get local issuer certificate|self signed certificate|certificate/i.test(
              proxyErrorMessage
            );

            if (isProxyCertIssue) {
              showAlert(
                "danger",
                "Could not fetch buckets: proxy TLS certificate trust issue. Configure container CA trust (S3_PROXY_CA_BUNDLE / AWS_CA_BUNDLE / NODE_EXTRA_CA_CERTS) or use S3_PROXY_INSECURE_TLS=true for testing only."
              );
              return;
            }

            const errorMessage =
              fallbackError && fallbackError.message
                ? fallbackError.message
                : e && e.message
                  ? e.message
                  : "Unknown error";
            const isAwsServiceEndpoint = /^https?:\/\/s3\.[a-z0-9-]+\.amazonaws\.com\/?$/i.test(
              endPointForFetch
            );
            const isBrowserNetworkFailure = /Failed to fetch|Network Failure|NetworkingError/i.test(
              errorMessage
            );

            if (isAwsServiceEndpoint && isBrowserNetworkFailure) {
              showAlert(
                "danger",
                "Bucket enumeration is blocked in-browser for this AWS service endpoint (network/CORS restriction). Credentials can still work for direct bucket access. Enter bucket name manually or use bucket-specific endpoint/CORS-enabled path. Open F12 for diagnostics."
              );
              return;
            }

            showAlert("danger", `Could not fetch buckets: ${errorMessage}. Open browser console (F12) for diagnostics.`);
          });
      });
  }

  handleSubmit(event) {
    event.preventDefault();
    const { showAlert, history } = this.props;
    let message = "";
    let isMinioServer = this.state.endPoint.substring(this.state.endPoint.length - 6).includes(":")

    if (this.state.accessKey === "") {
      message = "Access Key cannot be empty";
    }
    if (this.state.secretKey === "") {
      message = "Secret Key cannot be empty";
    }
    if (this.state.endPoint === "") {
      message = "End point cannot be empty";
    }
    if (this.state.region === "") {
      message = "Region cannot be empty";
    }
    if (this.state.endPoint === "https://s3.amazonaws.com") {
      message =
        "For AWS S3 endpoints we recommend to use the following syntax: https://s3.[region].amazonaws.com (e.g. https://s3.us-east-1.amazonaws.com)";
    }
    if (this.state.endPoint === "http://s3.amazonaws.com") {
      message =
        "For AWS S3 endpoints we recommend to use the following syntax: http://s3.[region].amazonaws.com (e.g. http://s3.us-east-1.amazonaws.com)";
    }


    if (
      this.state.endPoint.substring(0, 5) == "http:" &&
      location.protocol == "https:" &&
      isMinioServer == false
    ) {
      this.props.showAlert("info", "Auto-adjusting endpoint prefix from http:// to https:// to enable login via https:// browser URL")
      let endPointAdj = this.state.endPoint.replace("http://", "https://")
      this.setState({
        endPoint: endPointAdj,
      }, () => {

      });

    }
    else if (
      this.state.endPoint.substring(0, 5) == "http:" &&
      location.protocol == "https:"
    ) {
      message =
        "A http:// server cannot be accessed via a https:// browser frontend. Replace https:// with http:// in the CANcloud URL of your browser and hit enter.";
    }


    if (
      this.state.endPoint.substring(0, 5) != "http:" &&
      this.state.endPoint.substring(0, 6) != "https:"
    ) {
      message = "Please add http:// or https:// in front of your endpoint";
    }

    if (
      this.state.endPoint.substring(0, 6) != "https:" &&
      (browser.name == "chrome" || browser.name == "edge") &&
      isMinioServer == true
    ) {
      message = "It looks like you are trying to login to a TLS-disabled MinIO S3 server using a Chrome/Edge browser. This is not possible unless you are self-hosting CANcloud on the S3 server network. You can use Firefox instead - or enable TLS on your MinIO S3 server. See the S3 server documentation details.";
    }

    if (this.state.bucketName === "") {
      message = "Bucket Name is required";
    }

    if (message) {
      showAlert("danger", message);
      // return;
    }

    web
      .Login({
        accessKey: this.state.accessKey,
        secretKey: this.state.secretKey,
        endPoint: this.state.endPoint,
        region: this.state.region,
        bucketName: this.state.bucketName,
      })
      .then((res) => {
        history.push("/status-dashboard/");
        // console.log(res);
      })
      .catch((e) => {
        showAlert("danger", e.message + " - press F12 for details. " + message);
      });
  }

  componentWillMount() {
    const { clearAlert } = this.props;
    // Clear out any stale message in the alert of previous page
    clearAlert();
    document.body.classList.add("is-guest");
  }

  componentWillUnmount() {
    document.body.classList.remove("is-guest");
  }

  render() {
    const { clearAlert, alert } = this.props;
    const canFetchBuckets =
      this.state.accessKey.trim() !== "" &&
      this.state.secretKey.trim() !== "" &&
      this.state.endPoint.trim() !== "";
    if (web.LoggedIn()) {
      return <Redirect to={"/status-dashboard/"} />;
    }
    let alertBox = <Alert {...alert} onDismiss={clearAlert} />;
    // Make sure you don't show a fading out alert box on the initial web-page load.
    if (!alert.message) alertBox = "";
    return (
      <div className="login login-custom">
        {alertBox}
        <div className="l-wrap">
          <form onSubmit={this.handleSubmit.bind(this)} noValidate>
            <br />
            <br />
            <br />
            <InputGroup
              value={this.state.endPoint}
              onChange={this.endPointChange.bind(this)}
              className="ig-dark"
              label="End Point"
              id="endPoint"
              name="endpoint"
              type="text"
              spellCheck="false"
              required="required"
              autoComplete="endPoint"
            />
            <InputGroup
              value={this.state.accessKey}
              onChange={this.accessKeyChange.bind(this)}
              className="ig-dark"
              label="Access Key"
              id="accessKey"
              name="username"
              type="text"
              spellCheck="false"
              required="required"
              autoComplete="username"
            />
            <InputGroup
              value={this.state.secretKey}
              onChange={this.secretKeyChange.bind(this)}
              className="ig-dark"
              label="Secret Key"
              id="secretKey"
              name="password"
              type="password"
              spellCheck="false"
              required="required"
              autoComplete="new-password"
            />
            <InputGroup
              value={this.state.region}
              onChange={this.regionChange.bind(this)}
              className="ig-dark"
              label="Region"
              id="region"
              name="region"
              type="text"
              spellCheck="false"
              required="required"
              autoComplete="region"
            />

              <div className="login-bucket-row">
              <div className="input-group ig-dark login-bucket-group">
                {this.state.fetchedBuckets.length > 0 ? (
                  <select
                    id="bucketName"
                    name="bucketName"
                    value={this.state.bucketName}
                    onChange={this.bucketNameChange.bind(this)}
                    required
                    className="ig-text ig-combobox"
                    style={{ background: "#2d3339", color: "#fff" }}
                  >
                    <option value="">— select bucket —</option>
                    {this.state.fetchedBuckets.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="bucketName"
                    name="bucketName"
                    type="text"
                    value={this.state.bucketName}
                    onChange={this.bucketNameChange.bind(this)}
                    placeholder=""
                    title="Type a bucket name or fetch buckets to select"
                    autoComplete="bucketName"
                    required
                    className="ig-text"
                  />
                )}
                <i className="ig-helpers" />
                <label className="ig-label" style={this.state.fetchedBuckets.length > 0 ? { bottom: "35px", fontSize: "13px" } : undefined}>Bucket Name</label>
              </div>
              <button
                className="btn btn-dark-gray login-fetch-btn"
                type="button"
                onClick={this.fetchBuckets.bind(this)}
                disabled={this.state.isFetchingBuckets || !canFetchBuckets}
              >
                {this.state.isFetchingBuckets ? "Fetching..." : "Fetch buckets"}
              </button>
            </div>

            <button className="lw-btn" type="submit">
              <i className="fa fa-sign-in" />
            </button>
          </form>
          <br />
          <div>
            <Files
              onChange={(file) => {
                file.length
                  ? (this.onFileChange(file),
                    this.fileReader.readAsText(file[0]))
                  : this.onFilesError;
              }}
              onError={(error) => {
                this.onFilesError(error);
              }}
              accepts={[".json"]}
              multiple={false}
              maxFileSize={10000000}
              minFileSize={0}
              clickable
            >
              <button className="btn btn-dark-gray">Load from config</button>
            </Files>
          </div>

          <br />
          <div className="login-news">{news}</div>
        </div>
        <div className="l-footer">
          <a className="lf-logo" href="">
            <img src={logo} alt="" />
          </a>
        </div>
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch) => {
  return {
    showAlert: (type, message) =>
      dispatch(actionsAlert.set({ type: type, message: message })),
    clearAlert: () => dispatch(actionsAlert.clear()),
    login: (accessKey, secretKey, endPoint, region, bucketName) =>
      dispatch(
        actionsBrowser.login(accessKey, secretKey, endPoint, region, bucketName)
      ),
  };
};

module.exports = connect((state) => state, mapDispatchToProps)(Login);
