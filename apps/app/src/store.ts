import { atom } from "nanostores";
import type { Session } from "./api/types";

export const $session = atom<Session | null | undefined>(undefined);
