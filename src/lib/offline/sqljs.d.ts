// The slice of sql.js (SQLite compiled to WebAssembly) the app uses: open a
// database from bytes, run prepared statements, close it.
declare module "sql.js" {
  export type SqlValue = number | string | Uint8Array | null;
  export interface Statement {
    bind(params?: SqlValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlValue>;
    free(): boolean;
  }
  export interface Database {
    run(sql: string, params?: SqlValue[]): Database;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic { Database: new (data?: ArrayLike<number> | Buffer | null) => Database }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}

declare module "sql.js/dist/sql-wasm-browser.js" {
  export { default } from "sql.js";
}
