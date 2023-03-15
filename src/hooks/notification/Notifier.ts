import { Logger } from "pino";

export type NotificationContext = {
  logger: Logger;
};

export abstract class Notifier {
  abstract notify(message: string, context: NotificationContext): Promise<void>;
}
