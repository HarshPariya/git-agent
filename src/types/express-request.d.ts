import type { RequestHandler, Response } from "express";
import type { ParsedQs } from "querystring";

declare global {
  namespace Express {
    interface Request<ParamsDictionary = any, ResBody = any, ReqBody = any, ParsedQs = ParsedQs, ReqHeaders = any> {
      tenantContext?: import("../types/security").TenantContext;
      requestId?: string;
      workspaceRoot?: string;
    }
  }
}
