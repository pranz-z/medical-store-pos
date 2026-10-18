// Table exports only — this module is passed to Drizzle as the schema object.
// Column-builder helpers live in ./helpers and are imported directly by the
// table modules, never re-exported here.
export * from "./core";
export * from "./auth";
export * from "./catalog";
export * from "./purchasing";
export * from "./inventory";
export * from "./compliance";
export * from "./sales";
export * from "./system";
