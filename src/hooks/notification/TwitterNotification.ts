import axios from "axios";
import Twitter from "twitter";
import { auth, Client } from "twitter-api-sdk";

import { Notification } from "./Notification";



const publishTweet = async (message: string) => {
  try {
    const params = {
      status: message,
    };

    const response = await client.post("statuses/update", params);

    console.log(response);
  } catch (error) {
    console.error(error);
  }
};

const getTweet = async (tweetId: string) => {
  try {
    client.get(`statuses/show/${tweetId}`, function(error, tweet, response) {
      if (!error) {
        console.log(tweet);
      } else {
        console.error(error);
      }
    });
  } catch (error) {
    console.error(error);
  }
};

export class TwitterNotification {
  constructor() {
    publishTweet("Hello, Twitter! This is a test tweet.2");
    getTweet('1621306366013972482').then(console.log)
  }
}
