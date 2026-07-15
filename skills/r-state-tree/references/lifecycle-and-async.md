# Lifecycle and asynchronous ownership

Use this reference for Store effects, reactions, disposal, polling, async commands, hydration, or external resources.

## Registration semantics

Register owned reactions and effects in the Store constructor after `super(props)`:

```ts
class FilterStore extends Store<{ resourceId: string }> {
	constructor(props: FilterStore["props"]) {
		super(props);

		this.reaction(
			() => this.props.resourceId,
			(resourceId, previousResourceId) => {
				this.resourceChanged(previousResourceId, resourceId);
			}
		);
	}
}
```

Registrations activate only after the complete Store tree mounts. They activate bottom-up. A reaction captures its initial value and does not call its callback initially.

Use `this.effect()` for setup that must run at mount or owns a resource:

```ts
this.effect(() => {
	const connection = connect();
	return () => connection.close();
});
```

Calling a returned registration disposer before mount cancels the pending registration; calling it after mount stops the live registration. Terminal Store disposal stops all owned registrations automatically.

Do not invent `storeDidMount`, `storeWillUnmount`, mirrored `isMounted` flags, or lifecycle wrapper utilities.

## Choose causality before reaction

Use this order:

1. Handle a consequence directly in the authoritative method or external callback.
2. Enforce a domain invariant in the owning Model mutation.
3. Express pure derivation with a computed getter.
4. Use an effect for a resource tied to mounted Store lifetime.
5. Use a reaction when sources legitimately change through independent paths.

Avoid copying an event into an observable field and reacting to it solely to rediscover the same event. Before adding a reaction, identify every writer of its tracked values.

Do not track lossy collection fingerprints such as `ids.join()`, length alone, or serialized snapshots when meaningful item fields can change independently. Prefer the real mutation boundary or precise semantic fields.

## One-time setup and `untracked`

Prefer class defaults or constructor assignment for values derived only from props. Use a mount effect only when mounted Context, external resources, or activation order is required.

Wrap the complete synchronous setup path in `untracked()` when initialization reads must not create an ongoing subscription:

```ts
this.effect(() => {
	untracked(() => this.initializeFromCurrentState());
});
```

Helper methods called during setup may also read observables, so wrapping only the first read is insufficient.

Initialization must not read lazy child getters to start them or repair their Models. Put domain defaults in canonical Model snapshots/factories, pass child-owned session inputs through props, or move always-on work to the parent that owns it.

## Store lifetime signal

Every realized Store exposes a readonly `AbortSignal` as `this.signal`. It aborts when terminal disposal begins, before child disposal and effect cleanup.

```ts
async load() {
	const response = await fetch(this.url, { signal: this.signal });
	const data = await response.json();
	if (this.signal.aborted) return;
	this.apply(data);
}
```

For uncancellable work, check `this.signal.aborted` after every awaited boundary before committing results.

The lifetime signal does not define operation semantics. Keep separate controllers, revisions, or queues for:

- take-latest work;
- retries;
- polling cycles;
- user cancellation;
- overlapping commands.

## Async command policy

Choose a repeated-call policy for every public async command:

- ignore while active;
- share one in-flight promise;
- cancel previous;
- latest result wins;
- queue in order.

A loading flag enforces nothing unless the method checks it before starting. Guard finalization so an older operation cannot clear loading state or overwrite results for a newer one.

For latest-wins projections, snapshot canonical inputs and guard every commit with a monotonically increasing revision or an operation signal.

Record successful or deliberately terminal outcomes in `processedIds`-style bookkeeping. Do not mark transient failures as processed before durable work succeeds.

When independent projections run together, isolate expected failures and commits per branch so one rejection does not discard successful sibling results.

## Polling and asynchronous resources

Prefer self-scheduling polling: await one refresh, then schedule the next. Do not use `setInterval` around async work because requests can overlap.

Tie timers and operation controllers to an owned effect and cancel them in cleanup. If acquiring a resource asynchronously, immediately release a result that arrives after cleanup:

```ts
this.effect(() => {
	let active = true;
	let close: (() => void) | null = null;

	untracked(() => {
		void connect().then((connection) => {
			if (!active) {
				connection.close();
				return;
			}
			close = () => connection.close();
		});
	});

	return () => {
		active = false;
		close?.();
	};
});
```

## Persistence and hydration

Do not allow a persistence reaction to save constructor defaults before persisted state finishes loading. Track readiness explicitly and skip persistence until hydration resolves:

```ts
this.reaction(
	() => ({ hydrated: this.hydrated, view: this.view }),
	({ hydrated, view }) => {
		if (!hydrated) return;
		void saveView(view);
	}
);
```

Set readiness only after persisted state is applied or an intentional fallback is chosen.
