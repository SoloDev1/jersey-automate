import 'express';
import 'http';

declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

declare global {
  namespace Express {
    interface Request {
      organizationId: string;
      rawBody?: Buffer;
    }
  }
}

export {};
