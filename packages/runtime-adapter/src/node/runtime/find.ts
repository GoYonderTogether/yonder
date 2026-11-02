import { createFindTool as createSharedFindTool } from "../../runtime/find.js";
import { remoteFind } from "./remote-search.js";
export const createFindTool = () => createSharedFindTool(remoteFind);
