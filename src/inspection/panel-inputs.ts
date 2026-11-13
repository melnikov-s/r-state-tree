import { validateControlValue, type ControlValue } from "./protocol";
import type { InspectionParameter } from "./signatures";

export type ParameterInput = {
	container: HTMLElement;
	read(): ControlValue | undefined;
};

/** Inputs describe JSON data, never executable expressions or evaluated defaults. */
export function parameterInput(parameter: InspectionParameter): ParameterInput {
	const container = document.createElement("label");
	container.className = "parameter";
	const title = document.createElement("span");
	title.className = "parameter-name";
	title.textContent = parameter.name + (parameter.optional ? "?" : "");
	const type = document.createElement("span");
	type.className = "field-meta";
	type.textContent = parameter.type;
	container.append(title, type);
	const kind = parameter.rest ? "json" : parameter.kind;
	const input =
		kind === "boolean" || kind === "enum"
			? document.createElement("select")
			: kind === "json" || kind === "unknown"
				? document.createElement("textarea")
				: document.createElement("input");
	input.setAttribute("aria-label", `Parameter ${parameter.name}`);
	input.setAttribute("data-parameter", parameter.name);
	if (input instanceof HTMLSelectElement) {
		const empty = document.createElement("option");
		empty.value = "";
		empty.textContent = parameter.optional ? "Omit / use default" : "Choose…";
		input.append(empty);
		const choices =
			kind === "boolean" ? [true, false] : (parameter.choices ?? []);
		for (const choice of choices) {
			const option = document.createElement("option");
			option.value = JSON.stringify(choice);
			option.textContent = String(choice);
			input.append(option);
		}
	} else {
		input.placeholder = parameter.rest
			? "JSON array of remaining arguments"
			: parameter.optional
				? "Omit / use default"
				: kind === "json" || kind === "unknown"
					? "JSON value"
					: parameter.type;
		if (input instanceof HTMLTextAreaElement) input.rows = 2;
		if (input instanceof HTMLInputElement && kind === "number")
			input.inputMode = "decimal";
	}
	let supplied: HTMLInputElement | undefined;
	if (parameter.optional) {
		const toggle = document.createElement("span");
		toggle.className = "optional-parameter";
		supplied = document.createElement("input");
		supplied.type = "checkbox";
		supplied.setAttribute("aria-label", `Supply ${parameter.name}`);
		input.disabled = true;
		supplied.onchange = () => {
			input.disabled = !supplied!.checked;
		};
		toggle.append(supplied, "Supply argument (otherwise use default)");
		container.append(toggle);
	}
	container.append(input);
	return {
		container,
		read() {
			const text = input.value;
			if (supplied && !supplied.checked) return undefined;
			if (parameter.rest && !text.trim()) return [];
			if (text === "" && kind !== "string")
				throw new Error(`Enter ${parameter.name}.`);
			let value: ControlValue;
			if (kind === "string") value = text;
			else if (kind === "number") {
				if (!text.trim() || !Number.isFinite(Number(text)))
					throw new Error(`Enter a finite number for ${parameter.name}.`);
				value = Number(text);
			} else {
				try {
					value = JSON.parse(text);
					validateControlValue(value);
				} catch {
					throw new Error(`Enter valid JSON for ${parameter.name}.`);
				}
			}
			if (parameter.rest && !Array.isArray(value))
				throw new Error(`Enter a JSON array for ${parameter.name}.`);
			return value;
		},
	};
}

export function readArguments(
	parameters: InspectionParameter[],
	inputs: ParameterInput[]
): ControlValue[] {
	const values = inputs.map((input) => input.read());
	const last = values.length - 1;
	if (
		parameters[last]?.rest &&
		Array.isArray(values[last]) &&
		values[last].length === 0
	)
		values.pop();
	while (values.length && values[values.length - 1] === undefined) values.pop();
	const args: ControlValue[] = [];
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (value === undefined)
			throw new Error(
				`Supply ${parameters[i].name} before later arguments; only trailing arguments can be omitted.`
			);
		if (parameters[i].rest) args.push(...(value as ControlValue[]));
		else args.push(value);
	}
	return args;
}
