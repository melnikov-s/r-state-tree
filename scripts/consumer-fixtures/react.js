import * as core from "r-state-tree";
import * as adapter from "r-state-tree/react";
import * as React from "react";
import * as server from "react-dom/server";
import exercise from "./exercise.cjs";

exercise.react(core, adapter, React, server);
