export abstract class Database {
  abstract init(): Promise<void>;
  abstract check(orderId: string, handler: string): Promise<boolean>;

  abstract save(orderId: string, handler: string): Promise<void>;
}
