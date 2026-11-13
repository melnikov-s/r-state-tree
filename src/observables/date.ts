import { Administration } from "./internal/Administration";
import { getAdministration } from "./internal/lookup";
import { debugWrite, debugEnabled } from "./internal/debug";

export class DateAdministration extends Administration<Date> {
	static proxyTraps: ProxyHandler<Date> = {
		get(target, name: keyof Date): unknown {
			const adm = getAdministration(target);
			if (typeof adm.source[name] === "function") {
				if (typeof name === "string" && name.startsWith("set")) {
					addDateSetMethod(name);
				} else {
					addDateGetMethod(name);
				}

				return dateMethods[name];
			}

			return adm.source[name];
		},
	};
}

const dateMethods = Object.create(null);

function addDateSetMethod(method: PropertyKey): void {
	if (!dateMethods[method])
		dateMethods[method] = function (this: Date): unknown {
			const adm = getAdministration(this)! as Administration<Date>;
			const before = debugEnabled
				? Date.prototype.getTime.call(adm.source)
				: undefined;
			const res = (adm.source as any)[method].apply(adm.source, arguments);
			if (debugEnabled)
				debugWrite(
					adm.source,
					method,
					"date",
					before,
					Date.prototype.getTime.call(adm.source)
				);
			adm.atom.reportChanged();
			// Also flush coarse observers (used by reportObserved, e.g. snapshots)
			(adm as any).flushChange();
			return res;
		};
}

function addDateGetMethod(method: PropertyKey): void {
	if (!dateMethods[method])
		dateMethods[method] = function (this: Date): unknown {
			const adm = getAdministration(this)! as Administration<Date>;
			adm.atom.reportObserved();
			return (adm.source as any)[method].apply(adm.source, arguments);
		};
}
