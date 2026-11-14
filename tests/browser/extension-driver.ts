import {
	chromium,
	type BrowserContext,
	type CDPSession,
} from "@playwright/test";
import WebSocket from "ws";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Drive real Chrome DevTools targets, which Playwright deliberately omits from context.pages(). */
class DevToolsTarget {
	private id = 0;
	private pending = new Map<
		number,
		{
			resolve(value: any): void;
			reject(error: Error): void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	constructor(private socket: WebSocket) {
		socket.on("message", (raw) => {
			const data = JSON.parse(String(raw));
			const pending = this.pending.get(data.id);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(data.id);
			if (data.error) pending.reject(new Error(data.error.message));
			else pending.resolve(data.result);
		});
	}
	command(method: string, params: object = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = ++this.id;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP timeout: ${method}`));
			}, 10000);
			this.pending.set(id, { resolve, reject, timer });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}
	async evaluate(expression: string): Promise<any> {
		const result = await this.command("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails)
			throw new Error(JSON.stringify(result.exceptionDetails));
		return result.result.value;
	}
	async screenshot(path: string) {
		const result = await this.command("Page.captureScreenshot", {
			captureBeyondViewport: false,
		});
		await writeFile(path, Buffer.from(result.data, "base64"));
	}
	close() {
		this.socket.close();
	}
}
export async function launchExtension() {
	const profile = await mkdtemp(join(tmpdir(), "rst-extension-"));
	const extension = resolve("devtools/extension");
	let context: BrowserContext;
	try {
		context = await chromium.launchPersistentContext(profile, {
			channel: "chromium",
			headless: true,
			viewport: { width: 1440, height: 1000 },
			args: [
				`--disable-extensions-except=${extension}`,
				`--load-extension=${extension}`,
				"--auto-open-devtools-for-tabs",
				"--remote-debugging-port=0",
			],
		});
	} catch (error) {
		await rm(profile, { recursive: true, force: true });
		throw error;
	}
	const page = context.pages()[0];
	const session: CDPSession = await context.newCDPSession(page);
	const port = (
		await readFile(join(profile, "DevToolsActivePort"), "utf8")
	).split("\n")[0];
	const connections: DevToolsTarget[] = [];
	const targets = async (): Promise<{ targetId: string; url: string }[]> =>
		(await session.send("Target.getTargets")).targetInfos;
	const connect = async (targetId: string) => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/devtools/page/${targetId}`
		);
		await new Promise<void>((resolve, reject) => {
			socket.once("open", resolve);
			socket.once("error", reject);
		});
		const target = new DevToolsTarget(socket);
		connections.push(target);
		return target;
	};
	return {
		context,
		page,
		targets,
		connect,
		async openPanel() {
			const target = (await targets()).find((t) =>
				t.url.startsWith("devtools:")
			);
			if (!target) throw new Error("Chrome DevTools target unavailable");
			const devtools = await connect(target.targetId);
			// Chrome's frontend API selects the registered extension tab (possibly in overflow).
			await devtools.evaluate(`(async () => {
				const UI = await import('./ui/legacy/legacy.js');
				UI.DockController.DockController.instance().setDockSide('undocked');
				const view = UI.InspectorView.InspectorView.instance();
				const id = view.tabbedPane.tabIds().find(id => id.startsWith('chrome-extension:') && id.endsWith('RStateTree'));
				if (!id) throw new Error('RStateTree extension panel was not registered');
				await view.showPanel(id);
			})()`);
			await devtools.command("Emulation.setDeviceMetricsOverride", {
				width: 1100,
				height: 1100,
				deviceScaleFactor: 1,
				mobile: false,
			});
			return devtools;
		},
		async close() {
			for (const connection of connections) connection.close();
			await context.close();
			await rm(profile, { recursive: true, force: true });
		},
	};
}
