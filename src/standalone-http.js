#!/usr/bin/env node
/** Standalone HTTP sidecar for the OrcaSlicer plugin — only Orca/Z-Mod functionality. */
import { createHttpServer } from "./http.js";
import { MiniBridge } from "./mini-bridge.js";

const port = Number(process.env.MCP_HUB_HTTP_PORT || 8765);
createHttpServer(new MiniBridge(), { port });
