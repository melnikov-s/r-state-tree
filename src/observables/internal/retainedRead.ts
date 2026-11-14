/** Internal synchronous read scope: inspect retained children without reconciling them.
 * No devtools dependency, subscription, or production setup. Application execution is
 * unchanged outside the scope. Never retain computed caches produced in this scope.
 */
export let retainedChildRead = false;
export function withRetainedChildren<T>(read: () => T): T {
	const previous = retainedChildRead;
	retainedChildRead = true;
	try {
		return read();
	} finally {
		retainedChildRead = previous;
	}
}
