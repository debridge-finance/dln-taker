export abstract class Notification<T> {
  abstract notify(message: string, params?: T): Promise<void>;
}
