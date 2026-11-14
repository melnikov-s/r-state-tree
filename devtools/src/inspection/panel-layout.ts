/// <reference lib="dom" />
export type InspectorPanelOptions = {
	/** Defaults to document.body. The legacy HTMLElement second argument is also supported. */
	container?: HTMLElement;
	/** Embedded fills a container whose height is supplied by the app. */
	layout?: "floating" | "embedded";
	/** Fill the app viewport initially, not the operating system's native fullscreen. */
	fullscreen?: boolean;
	/** Floating defaults to collapsed, embedded to open; fullscreen always opens. */
	open?: boolean;
};

const scrollLocks = new WeakMap<
	Document,
	{ count: number; overflow: string; priority: string }
>();
const fullscreenHosts = new WeakMap<Document, HTMLElement[]>();
function lockPage(document: Document) {
	let lock = scrollLocks.get(document);
	if (lock) lock.count++;
	else {
		lock = {
			count: 1,
			overflow: document.documentElement.style.overflow,
			priority: document.documentElement.style.getPropertyPriority("overflow"),
		};
		scrollLocks.set(document, lock);
		document.documentElement.style.setProperty(
			"overflow",
			"hidden",
			"important"
		);
	}
	return () => {
		if (--lock.count > 0) return;
		scrollLocks.delete(document);
		if (
			document.documentElement.style.overflow === "hidden" &&
			document.documentElement.style.getPropertyPriority("overflow") ===
				"important"
		)
			document.documentElement.style.setProperty(
				"overflow",
				lock.overflow,
				lock.priority
			);
	};
}

/** Presentation and DOM lifetime only: never reads or changes application state. */
export function mountPanelLayout({
	host,
	shadow,
	shell,
	heading,
	toolbar,
	container,
	options,
}: {
	host: HTMLElement;
	shadow: ShadowRoot;
	shell: HTMLDetailsElement;
	heading: HTMLElement;
	toolbar: HTMLElement;
	container: HTMLElement;
	options: InspectorPanelOptions;
}) {
	const document = host.ownerDocument;
	const window = document.defaultView!;
	const button = document.createElement("button");
	button.type = "button";
	button.setAttribute("data-inspector-fullscreen-toggle", "");
	let fullscreen = false;
	let disposed = false;
	let returnSlot: Comment | undefined;
	let unlockPage: (() => void) | undefined;
	let previousFocus: Element | null = null;
	const savedAttributes = new Map<string, string | null>();
	let headingTabIndex: string | null = null;
	let headingDisabled: string | null = null;
	host.setAttribute("data-inspector-layout", options.layout ?? "floating");
	const updateButton = () => {
		button.textContent = fullscreen ? "Exit fullscreen" : "Fullscreen";
		button.setAttribute("aria-label", button.textContent);
		button.setAttribute("aria-pressed", String(fullscreen));
		button.title = fullscreen
			? "Restore the inspector's original layout (Escape)"
			: "Fill the app window";
	};
	const restoreFocus = () => {
		if (
			previousFocus?.isConnected &&
			"focus" in previousFocus &&
			typeof previousFocus.focus === "function"
		)
			previousFocus.focus({ preventScroll: true });
	};
	const focusTop = () => {
		const top = fullscreenHosts.get(document)?.at(-1);
		if (top)
			top.shadowRoot
				?.querySelector<HTMLButtonElement>("[data-inspector-fullscreen-toggle]")
				?.focus({ preventScroll: true });
		else restoreFocus();
	};
	const setFullscreen = (next: boolean, focus = true) => {
		if (disposed || next === fullscreen) return;
		fullscreen = next;
		if (next) {
			previousFocus = shadow.activeElement ?? document.activeElement;
			returnSlot = document.createComment("r-state-tree inspector return slot");
			host.before(returnSlot);
			// Leave transformed/clipping app panes behind while filling the viewport.
			(document.body ?? document.documentElement).append(host);
			unlockPage = lockPage(document);
			const stack = fullscreenHosts.get(document) ?? [];
			stack.push(host);
			fullscreenHosts.set(document, stack);
			host.setAttribute("data-fullscreen", "");
			for (const name of ["role", "aria-modal", "aria-label"])
				savedAttributes.set(name, host.getAttribute(name));
			host.setAttribute("role", "dialog");
			host.setAttribute("aria-modal", "true");
			host.setAttribute("aria-label", "RStateTree live inspector");
			headingTabIndex = heading.getAttribute("tabindex");
			headingDisabled = heading.getAttribute("aria-disabled");
			heading.tabIndex = -1;
			heading.setAttribute("aria-disabled", "true");
			shell.open = true;
		} else {
			host.removeAttribute("data-fullscreen");
			const stack = fullscreenHosts.get(document);
			const index = stack?.indexOf(host) ?? -1;
			if (stack && index >= 0) stack.splice(index, 1);
			if (!stack?.length) fullscreenHosts.delete(document);
			for (const [name, value] of savedAttributes) {
				if (value === null) host.removeAttribute(name);
				else host.setAttribute(name, value);
			}
			savedAttributes.clear();
			if (headingTabIndex === null) heading.removeAttribute("tabindex");
			else heading.setAttribute("tabindex", headingTabIndex);
			if (headingDisabled === null) heading.removeAttribute("aria-disabled");
			else heading.setAttribute("aria-disabled", headingDisabled);
			if (returnSlot?.parentNode) returnSlot.replaceWith(host);
			else container.append(host);
			returnSlot?.remove();
			returnSlot = undefined;
			unlockPage?.();
			unlockPage = undefined;
		}
		updateButton();
		if (focus) {
			if (next) button.focus({ preventScroll: true });
			else focusTop();
		}
	};
	const keydown = (event: KeyboardEvent) => {
		if (
			!fullscreen ||
			disposed ||
			fullscreenHosts.get(document)?.at(-1) !== host
		)
			return;
		// Keep app-level bubbling shortcuts out of the fullscreen inspector.
		event.stopPropagation();
		if (event.defaultPrevented) return;
		if (event.key === "Escape") {
			event.preventDefault();
			setFullscreen(false);
			return;
		}
		if (event.key !== "Tab") return;
		const focusable = [
			...shadow.querySelectorAll<HTMLElement>(
				"button,input,select,textarea,summary,[tabindex]"
			),
		].filter(
			(element) =>
				element.tabIndex >= 0 &&
				!element.matches(":disabled") &&
				element.getClientRects().length > 0
		);
		const first = focusable[0] ?? button;
		const last = focusable.at(-1) ?? button;
		const active = shadow.activeElement;
		if (
			!active ||
			!focusable.includes(active as HTMLElement) ||
			(!event.shiftKey && active === last) ||
			(event.shiftKey && active === first)
		) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		}
	};
	const shadowKeydown = (event: Event) => keydown(event as KeyboardEvent);
	const focusin = (event: FocusEvent) => {
		if (
			fullscreen &&
			!disposed &&
			fullscreenHosts.get(document)?.at(-1) === host &&
			!event.composedPath().includes(host)
		)
			button.focus({ preventScroll: true });
	};
	const headingClick = (event: MouseEvent) => {
		if (fullscreen) event.preventDefault();
	};
	button.onclick = () => setFullscreen(!fullscreen);
	updateButton();
	toolbar.append(button);
	shadow.addEventListener("keydown", shadowKeydown);
	window.addEventListener("keydown", keydown);
	document.addEventListener("focusin", focusin, true);
	heading.addEventListener("click", headingClick);
	shell.open = options.open ?? options.layout === "embedded";
	if (options.fullscreen) setFullscreen(true);

	return () => {
		if (disposed) return;
		const focusOutside =
			fullscreen &&
			previousFocus &&
			previousFocus.getRootNode() !== shadow &&
			previousFocus !== host;
		setFullscreen(false, false);
		disposed = true;
		button.onclick = null;
		shadow.removeEventListener("keydown", shadowKeydown);
		window.removeEventListener("keydown", keydown);
		document.removeEventListener("focusin", focusin, true);
		heading.removeEventListener("click", headingClick);
		button.remove();
		if (focusOutside) focusTop();
		previousFocus = null;
	};
}
