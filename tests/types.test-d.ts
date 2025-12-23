/**
 * Type-level regression tests for snapshot types.
 *
 * These tests verify compile-time type correctness using @ts-expect-error assertions.
 * Run with: npx tsc --noEmit -p tests/tsconfig.json
 */

import type { Signal } from "@preact/signals-core";
import type { SnapshotValue } from "../src/types";

// --- Helper types for compile-time assertions ---

// Asserts that type A equals type B
type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
	? 1
	: 2
	? true
	: false;

// --- SnapshotValue tests ---

// Test: Signal<number> snapshots as number
declare const signalNum: SnapshotValue<Signal<number>>;
const _signalNumCheck: number = signalNum;

// Test: Signal<Signal<string>> snapshots as string (nested unwrap)
declare const nestedSignal: SnapshotValue<Signal<Signal<string>>>;
const _nestedSignalCheck: string = nestedSignal;

// Test: Date snapshots as string
declare const dateSnap: SnapshotValue<Date>;
const _dateCheck: string = dateSnap;

// Test: Primitive passthrough
declare const strSnap: SnapshotValue<string>;
const _strCheck: string = strSnap;

declare const numSnap: SnapshotValue<number>;
const _numCheck: number = numSnap;

declare const boolSnap: SnapshotValue<boolean>;
const _boolCheck: boolean = boolSnap;

// Test: Arrays are recursively mapped
declare const arrSnap: SnapshotValue<Date[]>;
const _arrCheck: string[] = arrSnap;

// Test: Nested object recursion
declare const objSnap: SnapshotValue<{ a: { b: number; c: Date } }>;
const _objCheck: { a: { b: number; c: string } } = objSnap;

// Test: Signal inside object
declare const objWithSignal: SnapshotValue<{ count: Signal<number> }>;
const _objWithSignalCheck: { count: number } = objWithSignal;

// Test: Array of objects with Dates
declare const arrObjSnap: SnapshotValue<Array<{ date: Date }>>;
const _arrObjCheck: Array<{ date: string }> = arrObjSnap;

// --- Rejected types (should be never) ---

// Test: Map should be never
declare const mapSnap: SnapshotValue<Map<string, number>>;
// @ts-expect-error - Map snapshots are never, not assignable to object
const _mapFail: object = mapSnap;

// Test: Set should be never
declare const setSnap: SnapshotValue<Set<number>>;
// @ts-expect-error - Set snapshots are never, not assignable to object
const _setFail: object = setSnap;

// Test: WeakMap should be never
declare const weakMapSnap: SnapshotValue<WeakMap<object, number>>;
// @ts-expect-error - WeakMap snapshots are never, not assignable to object
const _weakMapFail: object = weakMapSnap;

// Test: WeakSet should be never
declare const weakSetSnap: SnapshotValue<WeakSet<object>>;
// @ts-expect-error - WeakSet snapshots are never, not assignable to object
const _weakSetFail: object = weakSetSnap;

// Test: RegExp should be never
declare const regexpSnap: SnapshotValue<RegExp>;
// @ts-expect-error - RegExp snapshots are never, not assignable to object
const _regexpFail: object = regexpSnap;

// Test: Error should be never
declare const errorSnap: SnapshotValue<Error>;
// @ts-expect-error - Error snapshots are never, not assignable to object
const _errorFail: object = errorSnap;

// Test: Promise should be never
declare const promiseSnap: SnapshotValue<Promise<number>>;
// @ts-expect-error - Promise snapshots are never, not assignable to object
const _promiseFail: object = promiseSnap;

// Test: bigint should be never
declare const bigintSnap: SnapshotValue<bigint>;
// @ts-expect-error - bigint snapshots are never, not assignable to number
const _bigintFail: number = bigintSnap;

// Test: symbol should be never
declare const symbolSnap: SnapshotValue<symbol>;
// @ts-expect-error - symbol snapshots are never, not assignable to symbol
const _symbolFail: symbol = symbolSnap;

// Test: function should be never
declare const fnSnap: SnapshotValue<() => void>;
// @ts-expect-error - function snapshots are never, not assignable to Function
const _fnFail: Function = fnSnap;

// This is a type-only test file - no runtime tests
export {};
