import { Pool } from "pg";

import { Hooks } from "../Hooks";

import { Database } from "./Database";

export class PostgresDatabase extends Database {
  private readonly pool: Pool;
  private isInited: boolean = false;

  constructor(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string
  ) {
    super();
    this.pool = new Pool({
      user,
      host,
      database,
      password,
      port,
    });
  }

  async init() {
    if (this.isInited) {
      return;
    }
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS handler_processing (order_id TEXT, handler TEXT);`
    );
    this.isInited = true;
  }

  async check(orderId: string, handler: string): Promise<boolean> {
    return (
      (
        await this.pool.query(
          `SELECT COUNT(*) as count FROM handler_processing WHERE order_id=$1 AND handler=$2;`,
          [orderId, handler]
        )
      ).rows[0].count !== "0"
    );
  }

  async save(orderId: string, handler: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO handler_processing(order_id, handler) VALUES($1, $2);`,
      [orderId, handler]
    );
  }
}
