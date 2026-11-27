import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { probeJudge, TESTED_OMP_VERSION } from "../src/judge.ts";

/**
 * Manual CI canary: loads the extension surface against the installed OMP and
 * records the capability probe. It makes no judge request and needs no
 * credentials. Run with:
 *   omp --mode json -p "/genie-canary" --no-session -e scripts/omp-capability-probe.ts
 */
export default function canary(pi: ExtensionAPI): void {
	pi.registerCommand("genie-canary", {
		description: "Record the OMP Genie judge capability probe without calling the judge",
		handler: async (_args, ctx) => {
			const probe = await probeJudge(ctx, pi.pi.VERSION);
			console.error(
				`CANARY:${JSON.stringify({
					version: pi.pi.VERSION,
					testedVersion: TESTED_OMP_VERSION,
					available: probe.available,
					reason: probe.reason,
					untestedVersion: probe.untestedVersion,
					primary: probe.primary,
					fallbacks: probe.fallbacks,
					capability: probe.capability,
				})}`,
			);
			ctx.shutdown();
		},
	});
}
