import { createStatusSurface, type Kernel, releaseInfo, type StatusSurface } from "@yonder/core";

/**
 * 启动状态面。
 *
 * 为什么单独成文件：`packages/cli/src/index.ts` 已经是千行级的命令分发文件，
 * 再往里塞"服务如何暴露自身状态"会让那个文件继续膨胀，也让状态面的读者
 * 不得不翻过一大段与命令解析无关的代码。
 */
export function startStatusSurface(home: string, kernel: Kernel): StatusSurface {
	const surface = createStatusSurface({
		home,
		source: {
			read: async () => {
				const info = await releaseInfo(home);
				return {
					ready: true,
					version: info.version,
					active: (await kernel.awakeActivity()).active,
					agents: await kernel.terminal.activity(),
				};
			},
			watermark: () => kernel.eventWatermark(),
		},
	});
	surface.start();
	return surface;
}
