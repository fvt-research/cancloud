/*
 * Minio Cloud Storage (C) 2018 Minio, Inc.
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
import InfiniteScroll from "react-infinite-scroll-component";
import * as actionsObjects from "./actions";
import ObjectsList from "./ObjectsList";
import CorsError from "./corsError";
import history from "../history";
import { pathSlice } from "../utils";
import { metaRequestQueue } from "../requestQueue";

// number of rows rendered per page by the infinite scroller
const PAGE_SIZE = 50;
// fetch meta data slightly beyond the rendered rows so scrolling rarely waits
const META_LOOKAHEAD = 20;

export class ObjectsListContainer extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      page: 1,
    };
    // names already passed to a meta fetch action (reset on navigation)
    this.requestedMeta = new Set();
    this.loadNextPage = this.loadNextPage.bind(this);
  }

  // fetch meta data for rendered rows (plus lookahead) that have none requested yet
  loadVisibleMetaData(props, page) {
    const { bucket, prefix } = pathSlice(history.location.pathname);
    if (bucket == "" || bucket == "Home" || !props.objects || props.objects.length == 0) {
      return;
    }

    const windowObjects = props.objects.slice(0, page * PAGE_SIZE + META_LOOKAHEAD);

    if (prefix == "") {
      // device root: session folder meta data
      const newPrefixes = windowObjects.filter(
        (object) => object.name.endsWith("/") && !this.requestedMeta.has(object.name)
      );
      if (newPrefixes.length > 0) {
        newPrefixes.forEach((object) => this.requestedMeta.add(object.name));
        this.props.fetchSessionMetaList(bucket, newPrefixes);
      }
    } else {
      // inside a session folder: per object meta data
      const newObjects = windowObjects.filter(
        (object) => !object.name.endsWith("/") && !this.requestedMeta.has(object.name)
      );
      if (newObjects.length > 0) {
        newObjects.forEach((object) => this.requestedMeta.add(object.name));
        this.props.fetchSessionObjectsMetaList(bucket, prefix, newObjects);
      }
    }
  }

  componentWillReceiveProps(nextProps) {
    const { bucket } = pathSlice(history.location.pathname);
    let page = this.state.page;

    // reset page and meta data on navigation
    if (this.props.currentBucket != nextProps.currentBucket || bucket == "Home" || this.props.currentPrefix != nextProps.currentPrefix) {
      this.props.resetSessionMetaList();
      this.props.resetObjectsS3MetaStart();
      this.requestedMeta.clear();
      metaRequestQueue.clear();
      page = 1;
      this.setState({
        page: 1,
      });
    }

    // load meta data for the rendered rows when the object list changes
    if (this.props.objects != nextProps.objects && nextProps.objects.length) {
      this.loadVisibleMetaData(nextProps, page);
    }
  }

  componentWillUnmount() {
    this.props.resetSessionMetaList();
    this.props.resetObjectsS3MetaStart();
    this.requestedMeta.clear();
    metaRequestQueue.clear();
  }

  loadNextPage() {
    this.setState(
      (state) => {
        return {
          page: state.page + 1,
        };
      },
      () => {
        this.loadVisibleMetaData(this.props, this.state.page);
      }
    );
  }

  render() {
    const {
      objects = [],
      isTruncated,
      currentBucket,
      loadObjects,
      err,
      sessionMetaList,
      objectsS3MetaStart,
    } = this.props;

    const { prefix } = pathSlice(history.location.pathname);
    let visibleObjects = objects.slice(0, this.state.page * PAGE_SIZE);

    if (prefix == "") {
      // Load file objects separately to ensure they are always included at the top when existing
      let fileObjects = objects.filter((object) => !object.name.endsWith("/"))
      visibleObjects = Array.from(new Set(fileObjects.concat(visibleObjects) ));
    }
    return (
      <div
        className="feb-container"
        style={{
          position: "relative",
        }}
      >
        <InfiniteScroll
          pageStart={0}
          dataLength={visibleObjects.length}
          children={objects}
          next={visibleObjects.length > 0 ? this.loadNextPage : () => { }}
          hasMore={visibleObjects.length < objects.length}
          loader={<h4>Loading...</h4>}
          // useWindow={true}
          initialLoad={false}
        >
          {err == "noBucket" ? (
            <div className="text-center">
              {" "}
              <span> No Content </span>{" "}
            </div>
          ) : null}{" "}
          {err == "load" ? (
            <div className="text-center">
              {" "}
              <span> Loading... </span>{" "}
            </div>
          ) : null}{" "}
          {err != "noBucket" && err != "load" && !err ? (
            <ObjectsList
              objects={visibleObjects}
              sessionMetaList={sessionMetaList}
              objectsS3MetaStart={objectsS3MetaStart}
            />
          ) : null}{" "}
          {err != "noBucket" && err != "load" && err ? <CorsError currentBucket={currentBucket} /> : null}{" "}
        </InfiniteScroll>{" "}

        <div
          className="text-center"
          style={{
            display: isTruncated && currentBucket ? "block" : "none",
          }}
        >
          <span> Loading... </span>{" "}
        </div>{" "}
      </div>
    );
  }
}

const mapStateToProps = (state) => {
  return {
    currentBucket: state.buckets.currentBucket,
    currentPrefix: state.objects.currentPrefix,
    objects: state.objects.list,
    err: state.objects.err,
    isTruncated: state.objects.isTruncated,
    sessionMetaList: state.objects.sessionMetaList,
    objectsS3MetaStart: state.objects.objectsS3MetaStart,
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    loadObjects: (append) => dispatch(actionsObjects.fetchObjects(append)),
    fetchSessionMetaList: (bucket, prefixList) => dispatch(actionsObjects.fetchSessionMetaList(bucket, prefixList)),
    fetchSessionObjectsMetaList: (bucket, prefix, objectsList) => dispatch(actionsObjects.fetchSessionObjectsMetaList(bucket, prefix, objectsList)),
    resetSessionMetaList: () => dispatch(actionsObjects.resetSessionMetaList()),
    resetObjectsS3MetaStart: () => dispatch(actionsObjects.resetObjectsS3MetaStart()),
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(ObjectsListContainer);
