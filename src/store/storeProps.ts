import { batch, getAdministration, untracked } from "../observables/index.js";
import type { PreactObjectAdministration as ObjectAdministration } from "../observables/index.js";
import { debugEnabled } from "../observables/internal/debug.js";
import type { Props } from "../types.js";
import type { StoreAdministration } from "./StoreAdministration.js";

function updatePropsByAdm(
	adm: ObjectAdministration<Props>,
	newProps: Props
): void {
	if (debugEnabled) {
		const proxy = adm.proxy;
		for (const key in newProps) {
			if (Object.prototype.hasOwnProperty.call(newProps, key)) {
				proxy[key] = newProps[key];
			}
		}
		return;
	}
	const source = adm.source;
	for (const key in newProps) {
		if (!Object.prototype.hasOwnProperty.call(newProps, key)) continue;
		const val = newProps[key];
		const isObj = typeof val === "object" && val !== null;
		if (isObj) {
			const valAdm = getAdministration(val);
			if (valAdm && valAdm.proxy === val) {
				if (
					adm.hasExplicitObservable(key) &&
					Object.prototype.hasOwnProperty.call(source, key) &&
					source[key] === valAdm.source
				) {
					continue;
				}
				adm.write(key, val);
				continue;
			}
		}
		if (
			Object.prototype.hasOwnProperty.call(source, key) &&
			source[key] === val &&
			!adm.hasExplicitObservable(key)
		) {
			continue;
		}
		adm.write(key, val);
	}
}

function updateRawProps(adm: StoreAdministration, newProps: Props): void {
	const source = (adm.source as any).props as Record<string, unknown>;
	let explicitKeys = adm._propsExplicitKeys;
	for (const key in newProps) {
		if (!Object.prototype.hasOwnProperty.call(newProps, key)) continue;
		const val = newProps[key];
		if (
			source[key] === val &&
			!explicitKeys?.has(key) &&
			Object.prototype.hasOwnProperty.call(source, key)
		) {
			continue;
		}
		if (typeof val === "object" && val !== null) {
			const valAdm = getAdministration(val);
			if (valAdm && valAdm.proxy === val) {
				(explicitKeys ??= adm._propsExplicitKeys = new Set()).add(key);
				source[key] = valAdm.source;
				continue;
			}
		}
		explicitKeys?.delete(key);
		source[key] = val;
	}
}

export function updateStoreProps(
	adm: StoreAdministration,
	newProps: Props
): void {
	if (adm.propsAdm) {
		updatePropsByAdm(adm.propsAdm, newProps);
	} else if (debugEnabled) {
		updatePropsInner(adm.proxy.props, newProps);
	} else {
		updateRawProps(adm, newProps);
	}
}
function updatePropsInner(props: Props, newProps: Props): void {
	const adm = getAdministration(props);
	if (adm) {
		updatePropsByAdm(adm, newProps);
		return;
	}
	for (const key in newProps) {
		if (Object.prototype.hasOwnProperty.call(newProps, key)) {
			props[key] = newProps[key];
		}
	}
}

export function updateProps(props: Props, newProps: Props): void {
	untracked(() => {
		batch(() => {
			updatePropsInner(props, newProps);
		});
	});
}
