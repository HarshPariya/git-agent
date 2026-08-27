declare global {
  namespace Express {
    interface Request {
      readonly requestId?: string;
    }
  }
}

export {};
