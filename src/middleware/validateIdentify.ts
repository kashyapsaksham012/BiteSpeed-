import { Request, Response, NextFunction } from "express";

export const validateIdentify = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const rawEmail = req.body?.email ?? null;
  const rawPhone = req.body?.phoneNumber ?? null;

  if (rawEmail !== null && typeof rawEmail !== "string") {
    const error = new Error("email must be a string or null") as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    return next(error);
  }

  if (rawPhone !== null && typeof rawPhone !== "string") {
    const error = new Error("phoneNumber must be a string or null") as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    return next(error);
  }

  const email = rawEmail ? rawEmail.trim() : null;
  const phoneNumber = rawPhone ? rawPhone.trim() : null;

  if (!email && !phoneNumber) {
    const error = new Error("email or phoneNumber is required") as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    return next(error);
  }

  req.body = { email, phoneNumber };
  return next();
};
