export abstract class Notification {
  abstract notify(message: string): Promise<void>;
}
