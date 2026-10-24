/**
 * Background-agent engines for the services (goals, library — forks #4,
 * #15): the BYOK chain for a role with the same honest refusals a turn
 * gives — no model in the role's slot, the provider's key missing, or
 * ChatGPT background use off for an automatic run. Plus the one error type
 * those services throw for the routes to map to HTTP.
 */

import type { ModelRole } from "../../config.ts";
import { modelsNotConfigured, providerKeyMissing, ROLE_SLOT } from "../core/settings.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { chatGPTBackgroundAllowed } from "../agent/chatgpt-bridge.ts";
import { stores } from "./stores.ts";
import { providerKeyPresent } from "./keys.ts";
import { refreshConnectionCatalog } from "./model-catalog.ts";

/** A refusal the routes map to HTTP (status + message). */
export class GoalServiceError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 | 503,
	) {
		super(message);
		this.name = "GoalServiceError";
	}
}

/** Test seam: a scripted engine replaces every role's production one. */
export const serviceEngineOverride: { current?: PiEngine } = {};

export async function engineForRole(role: ModelRole, background: boolean, chatGPTBackgroundRefusal: string): Promise<PiEngine> {
	if (serviceEngineOverride.current) return serviceEngineOverride.current;
	const slot = ROLE_SLOT[role];
	const spec = resolveRoleSpec(role, stores.settingsStore.readSettings());
	if (!spec) throw new GoalServiceError(modelsNotConfigured([slot]).error, 503);
	if (spec.provider === "chatgpt") {
		await refreshConnectionCatalog();
		if (background && !chatGPTBackgroundAllowed()) throw new GoalServiceError(chatGPTBackgroundRefusal, 503);
	}
	if (!providerKeyPresent(spec.provider)) throw new GoalServiceError(providerKeyMissing(spec.provider, [slot]).error, 503);
	return piEngineForSpec(spec, background);
}
