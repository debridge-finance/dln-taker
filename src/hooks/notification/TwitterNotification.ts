import Twitter from "twitter";

import { Notification, NotificationContext } from "./Notification";

export class TwitterNotification implements Notification {
  private readonly client: Twitter;

  constructor(
    consumerKey: string,
    consumerSecret: string,
    accessTokenKey: string,
    accessTokenSecret: string
  ) {
    this.client = new Twitter({
      consumer_key: consumerKey,
      consumer_secret: consumerSecret,
      access_token_key: accessTokenKey,
      access_token_secret: accessTokenSecret,
    });
  }

  async notify(message: string, context: NotificationContext) {
    const params = {
      status: message,
    };
    const logger = context.logger.child({
      notification: TwitterNotification.name,
    });

    try {
      const response = await this.client.post("statuses/update", params);
      logger.debug(`Response ${JSON.stringify(response)}`);
    } catch (e) {
      logger.error(`Error in sending ${e}`);
      logger.error(e);
      throw e;
    }
  }
}
