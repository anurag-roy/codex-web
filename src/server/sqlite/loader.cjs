// This file is copied to scratch/asar/node_modules/better-sqlite3/index.js.
const { existsSync } = require("node:fs");
const { Database } = require("bun:sqlite");

class BetterSqlite3Compat extends Database {
  constructor(filename, options = {}) {
    if (options.fileMustExist && !existsSync(filename)) {
      throw new Error(`Database file does not exist: ${filename}`);
    }

    super(filename, {
      create: !options.fileMustExist && !options.readonly,
      readonly: options.readonly,
      readwrite: !options.readonly,
    });
  }

  async backup(destination) {
    await Bun.write(destination, this.serialize());
    return { totalPages: 0, remainingPages: 0 };
  }
}

module.exports = BetterSqlite3Compat;
module.exports.Database = BetterSqlite3Compat;
module.exports.default = BetterSqlite3Compat;
