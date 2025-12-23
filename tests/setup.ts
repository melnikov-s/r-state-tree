/**
 * Test setup: suppress console.warn during tests.
 * Dev warnings (uninstrumented methods, unsupported patterns, etc.) can clutter test output.
 */

const originalWarn = console.warn;

beforeAll(() => {
	console.warn = () => {};
});

afterAll(() => {
	console.warn = originalWarn;
});
