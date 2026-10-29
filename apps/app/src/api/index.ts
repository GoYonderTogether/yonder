import type { ApiClient } from "./client";
import { httpApi } from "./http";
import { mockApi } from "./mock";

export const api: ApiClient = import.meta.env.VITE_API === "http" ? httpApi : mockApi;
