export class Expo {
  constructor() {}
  sendPushNotificationsAsync() {
    return Promise.resolve([]);
  }
}

export type ExpoPushMessage = Record<string, any>;
export type ExpoPushTicket = Record<string, any>;
export type ExpoPushErrorData = Record<string, any>;
