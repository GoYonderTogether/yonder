import { createGrepTool as createSharedGrepTool } from "../../runtime/grep.js";
import { remoteGrep } from "./remote-search.js";
export const createGrepTool = () => createSharedGrepTool(remoteGrep);
