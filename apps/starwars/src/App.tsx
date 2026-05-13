import type { Component } from "solid-js";
import { Router, Route } from "@solidjs/router";
import Landing from "./pages/Landing";
import Tcw from "./pages/Tcw";
import { refreshAuth } from "./lib/api";

void refreshAuth();

// Tcw is built to live inside a constrained, padded, full-height flex column —
// the page's internal scroll behavior depends on that shell. Pitwall provided
// it at the App level; we do the same here.
const TcwShell: Component = () => (
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <div class="max-w-5xl mx-auto px-4 py-6 h-screen flex flex-col">
      <Tcw />
    </div>
  </div>
);

const App: Component = () => {
  return (
    <Router>
      <Route path="/" component={Landing} />
      <Route path="/tcw" component={TcwShell} />
    </Router>
  );
};

export default App;
