import { Administration } from "./internal/Administration";
import { getAdministration } from "./internal/lookup";

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
			const res = (adm.source as any)[method].apply(adm.source, arguments);
			adm.atom.reportChanged();
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
