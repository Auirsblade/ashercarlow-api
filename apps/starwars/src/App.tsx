import type { Component } from "solid-js";
import { Router, Route } from "@solidjs/router";
import Landing from "./pages/Landing";
import Tcw from "./pages/Tcw";
import { refreshAuth } from "./lib/api";

void refreshAuth();

const App: Component = () => {
  return (
    <Router>
      <Route path="/" component={Landing} />
      <Route path="/tcw" component={Tcw} />
    </Router>
  );
};

export default App;
