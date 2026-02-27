import { Request, Response, NextFunction } from "express";

export interface HttpError extends Error {
  statusCode?: number;
}

export const errorHandler = (
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.statusCode ?? 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({ error: message });
};
