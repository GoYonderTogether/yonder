import type { ResolvedSession, ServicesWiring as SharedServicesWiring } from "@yonder/bot-core/kernel/services-wiring";
import { createKernelServices as createSharedKernelServices } from "@yonder/bot-core/kernel/services-wiring";
import type { KernelServices } from "@yonder/bot-core/plugins/services";
import { hostService } from "@yonder/local-host/kernel/host-status";

export type ServicesWiring = Omit<SharedServicesWiring, "host">;

export function createKernelServices(wiring: ServicesWiring): KernelServices {
	return createSharedKernelServices({
		...wiring,
		host: hostService(wiring.home, wiring.config, () => ({
			runtime: wiring.runtime(),
			loaded: wiring.loaded(),
			agents: wiring.agents,
			services: wiring.services(),
		})),
	});
}

export type { ResolvedSession };
