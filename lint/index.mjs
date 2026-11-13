import { analysis, unwrap, key, mutators } from "./analysis.mjs";
import { checkPurity } from "./purity.mjs";
import { checkDiscardedChildReads } from "./child-reads.mjs";

const messages = {
	"no-computed-mutation":
		"Do not mutate existing or externally sourced state during a computed derivation. Build a fresh local result instead.",
	"no-direct-construction":
		"Create this {{kind}} with {{factory}}, not new; direct construction bypasses r-state-tree initialization.",
	"no-plain-collection-mutation":
		"Field '{{field}}' is initialized with a plain collection. In-place mutation is not reactive; wrap it with observable() or reassign the whole field.",
	"no-observable-collection-replacement":
		"Field '{{field}}' is initialized with an observable collection. Preserve its identity and mutate it in place outside computed derivations.",
	"no-discarded-child-read":
		"Reading lazy Store child '{{field}}' without using its value may initialize it. If this is intentional warmup, document and suppress this warning; otherwise consume the child where needed.",
};

function rule(id, run) {
	return {
		meta: {
			type: id === "no-discarded-child-read" ? "suggestion" : "problem",
			docs: {
				description: messages[id],
				url: `https://github.com/melnikov-s/r-state-tree/blob/main/lint/README.md#${id}`,
			},
			schema: [],
			messages: { mutation: messages[id] },
		},
		create(context) {
			return {
				"Program:exit"(program) {
					const a = analysis(context.sourceCode);
					const reported = new Set();
					const report = (node, data) => {
						if (reported.has(node)) return;
						reported.add(node);
						context.report({ node, messageId: "mutation", data });
					};
					run(program, a, report);
				},
			};
		},
	};
}

export const rules = {
	"no-computed-mutation": rule("no-computed-mutation", (program, a, report) => {
		const roots = new Set();
		a.walk(program, (node) => {
			if (
				node.type === "MethodDefinition" &&
				node.kind === "get" &&
				!node.static
			) {
				const cls = node.parent.parent;
				if (
					a.classKind(cls) ||
					a.config(cls).get(node.key.name ?? node.key.value) === "computed"
				) {
					roots.add(node.value);
					checkPurity(node.value, cls, a, report);
				}
			}
			if (node.type === "CallExpression" && a.api(node.callee) === "computed") {
				let fn = unwrap(node.arguments[0]);
				if (fn?.type === "Identifier") {
					const def = a.variable(fn)?.defs[0];
					fn =
						def?.type === "FunctionName"
							? def.node
							: unwrap(a.immutableInit(fn));
				}
				if (
					fn &&
					[
						"ArrowFunctionExpression",
						"FunctionExpression",
						"FunctionDeclaration",
					].includes(fn.type) &&
					!roots.has(fn)
				) {
					roots.add(fn);
					checkPurity(fn, a.enclosingClass(node), a, report);
				}
			}
		});
	}),
	"no-direct-construction": rule(
		"no-direct-construction",
		(program, a, report) => {
			a.walk(program, (node) => {
				if (node.type !== "NewExpression") return;
				const kind = a.classKind(node.callee);
				if (kind)
					report(node, {
						kind,
						factory:
							kind === "Store"
								? "createStore(Type, props)"
								: "Type.create(snapshot)",
					});
			});
		}
	),
	"no-plain-collection-mutation": rule(
		"no-plain-collection-mutation",
		(program, a, report) => {
			a.walk(program, (node) => {
				const cls = a.enclosingClass(node);
				if (!a.classKind(cls)) return;
				let target;
				if (
					node.type === "CallExpression" &&
					node.callee.type === "MemberExpression"
				) {
					target = a.fieldRef(node.callee.object, cls);
					if (
						!target ||
						target.depth !== 0 ||
						!mutators[target.kind]?.has(key(node.callee))
					)
						return;
				} else if (
					["AssignmentExpression", "UpdateExpression"].includes(node.type) ||
					(node.type === "UnaryExpression" && node.operator === "delete")
				) {
					target = a.fieldRef(node.left ?? node.argument, cls);
					if (!target || target.depth < 1) return;
				} else return;
				if (!target.wrapped) report(node, { field: target.field });
			});
		}
	),
	"no-observable-collection-replacement": rule(
		"no-observable-collection-replacement",
		(program, a, report) => {
			a.walk(program, (node) => {
				if (node.type !== "AssignmentExpression" || node.operator !== "=")
					return;
				const cls = a.enclosingClass(node);
				if (!a.classKind(cls)) return;
				const target = a.fieldRef(node.left, cls);
				if (target?.wrapped && target.depth === 0 && a.freshShape(node.right))
					report(node, { field: target.field });
			});
		}
	),
	"no-discarded-child-read": rule(
		"no-discarded-child-read",
		checkDiscardedChildReads
	),
};

export default { meta: { name: "r-state-tree" }, rules };
