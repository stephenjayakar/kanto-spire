/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as ascension from "../ascension.js";
import type * as auth from "../auth.js";
import type * as coop from "../coop.js";
import type * as coopTest from "../coopTest.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as lib from "../lib.js";
import type * as migrations from "../migrations.js";
import type * as packs from "../packs.js";
import type * as players from "../players.js";
import type * as progress from "../progress.js";
import type * as runlogs from "../runlogs.js";
import type * as runs from "../runs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  ascension: typeof ascension;
  auth: typeof auth;
  coop: typeof coop;
  coopTest: typeof coopTest;
  http: typeof http;
  invites: typeof invites;
  lib: typeof lib;
  migrations: typeof migrations;
  packs: typeof packs;
  players: typeof players;
  progress: typeof progress;
  runlogs: typeof runlogs;
  runs: typeof runs;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
