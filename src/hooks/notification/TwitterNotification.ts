import Twitter from "twitter";

import { Notification } from "./Notification";

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

  async notify(message: string): Promise<void> {
    try {
      const params = {
        status: message,
      };
      const response = await this.client.post("statuses/update", params);
    } catch (error) {
      console.error(error);
    }
    return Promise.resolve(undefined);
  }
}
