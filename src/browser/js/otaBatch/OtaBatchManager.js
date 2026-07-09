import React from "react";

import SideBar from "../browser/SideBar";
import MobileHeader from "../browser/MobileHeader";
import Header from "../browser/Header";
import AlertContainer from "../alert/AlertContainer";
import web from "../web";
import OtaBatchSection from "./OtaBatchSection";

const OtaBatchManager = () => (
  <div>
    <SideBar />
    <div className="fe-body">
      {web.LoggedIn() && <MobileHeader />}
      <Header />
      <OtaBatchSection />
    </div>
    <AlertContainer />
  </div>
);

export default OtaBatchManager;
