import { Logger } from "pino";

export type NotificationContext = {
  logger: Logger;
};

export abstract class Notification {
  abstract notify(message: string, context: NotificationContext): Promise<void>;
}
