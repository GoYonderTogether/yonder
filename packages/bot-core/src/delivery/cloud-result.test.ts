import { expect, test } from "vitest";
import { cloudFailure } from "./cloud-result.js";

test("quota admission HTTP errors keep their real service cause", () => {
	expect(cloudFailure("model_error: 云端额度服务暂不可用（HTTP 503）")).toBe("云端额度服务暂不可用（HTTP 503）");
	expect(cloudFailure("model_error: 已达到云端 Bot 每小时回复上限")).toBe("已达到云端 Bot 每小时回复上限");
	expect(cloudFailure("model_error: upstream HTTP 503")).toBe("云端模型调用失败：上游返回 HTTP 503");
});
