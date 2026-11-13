// @vitest-environment jsdom
import { parameterInput, readArguments } from "../src/inspection/panel-inputs";
import type { InspectionParameter } from "../src/inspection/signatures";

function inputs(parameters: InspectionParameter[]) {
	return parameters.map((parameter) => parameterInput(parameter));
}
function set(input: ReturnType<typeof parameterInput>, value: string) {
	input.container.querySelector<
		HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
	>("[data-parameter]")!.value = value;
}
function supply(input: ReturnType<typeof parameterInput>) {
	const toggle = input.container.querySelector<HTMLInputElement>(
		".optional-parameter input"
	)!;
	toggle.checked = true;
	toggle.dispatchEvent(new Event("change"));
}

test("parameter inputs preserve typed strings, numbers, booleans and literal choices", () => {
	const parameters: InspectionParameter[] = [
		{ name: "text", type: "string", kind: "string" },
		{ name: "amount", type: "number", kind: "number" },
		{ name: "enabled", type: "boolean", kind: "boolean" },
		{
			name: "mode",
			type: '"light" | "dark"',
			kind: "enum",
			choices: ["light", "dark"],
		},
	];
	const fields = inputs(parameters);
	["", "2.5", "false", '"dark"'].forEach((value, i) => set(fields[i], value));
	expect(readArguments(parameters, fields)).toEqual(["", 2.5, false, "dark"]);
	set(fields[1], "Infinity");
	expect(() => readArguments(parameters, fields)).toThrow("finite number");
	set(fields[1], " ");
	expect(() => readArguments(parameters, fields)).toThrow("finite number");
});

test("optional arguments are explicitly omitted or supplied, including an empty string", () => {
	const parameters: InspectionParameter[] = [
		{ name: "text", type: "string", kind: "string", optional: true },
		{ name: "amount", type: "number", kind: "number", optional: true },
	];
	const fields = inputs(parameters);
	expect(readArguments(parameters, fields)).toEqual([]);
	supply(fields[1]);
	set(fields[1], "3");
	expect(() => readArguments(parameters, fields)).toThrow(
		"only trailing arguments can be omitted"
	);
	supply(fields[0]);
	set(fields[0], "");
	expect(readArguments(parameters, fields)).toEqual(["", 3]);
});

test("complex and unknown arguments use individual bounded JSON inputs; rest values spread", () => {
	const parameters: InspectionParameter[] = [
		{ name: "options", type: "Options", kind: "json" },
		{ name: "items", type: "string[]", kind: "json", rest: true },
	];
	const fields = inputs(parameters);
	set(fields[0], '{"mode":"copy"}');
	set(fields[1], '["a","b"]');
	expect(readArguments(parameters, fields)).toEqual([
		{ mode: "copy" },
		"a",
		"b",
	]);
	set(fields[1], "");
	expect(readArguments(parameters, fields)).toEqual([{ mode: "copy" }]);
	set(fields[1], '"a"');
	expect(() => readArguments(parameters, fields)).toThrow("JSON array");
	set(fields[0], '{"__proto__":{}}');
	expect(() => readArguments(parameters, fields)).toThrow("valid JSON");
});

test("an empty trailing rest argument does not prevent preceding defaults from being omitted", () => {
	const parameters: InspectionParameter[] = [
		{ name: "value", type: "number", kind: "number", optional: true },
		{ name: "items", type: "string[]", kind: "json", rest: true },
	];
	const fields = inputs(parameters);
	set(fields[1], "");
	expect(readArguments(parameters, fields)).toEqual([]);
	set(fields[1], "[]");
	expect(readArguments(parameters, fields)).toEqual([]);
	set(fields[1], '["later"]');
	expect(() => readArguments(parameters, fields)).toThrow(
		"only trailing arguments can be omitted"
	);
	supply(fields[0]);
	set(fields[0], "4");
	expect(readArguments(parameters, fields)).toEqual([4, "later"]);
});

test("labels and type names are text, never HTML", () => {
	const input = parameterInput({
		name: '<img src=x onerror="alert(1)">',
		type: "<script>alert(1)</script>",
		kind: "unknown",
	});
	expect(input.container.querySelector("img,script")).toBeNull();
	expect(input.container.textContent).toContain("<script>");
});
