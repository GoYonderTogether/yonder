// Deprecated alias of @yonder/plugin-learning/recipe bound to the legacy plugin id.
import { registration as base, runtimeProfile as profile } from "@yonder/plugin-learning/recipe";

export { recipeId, systemIdentity } from "@yonder/plugin-learning/recipe";
export const runtimeProfile = (enabled = true, learning = true) => profile(enabled, learning, "hermes-experience");
export const registration = (owner, learning = true) => base(owner, learning, "hermes-experience");
