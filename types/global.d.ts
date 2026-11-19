declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: "development" | "production" | string;
    BLUEBIRD_W_FORGOTTEN_RETURN?: string;
  }
}

declare var GoatBot: any;
declare var db: any;
declare var client: any;
declare var utils: any;
declare var temp: any;
declare var botID: string;
declare var statusAccountBot: string;
declare var responseUptimeCurrent: any;
declare var intervalRestartListenMqtt: any;

declare module "gradient-string";
declare module "npmlog";
declare module "ora";
declare module "fs-extra";
declare module "totp-generator";
declare module "qrcode-reader";
declare module "yt-search";
declare module "mime-db";
declare module "fca-nx";
