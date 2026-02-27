import { Request, Response, NextFunction } from "express";
import { identifyContact } from "../services/identifyService";

export const identifyController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, phoneNumber } = req.body as {
      email: string | null;
      phoneNumber: string | null;
    };

    const result = await identifyContact(email, phoneNumber);
    return res.status(200).json(result);
  } catch (error) {
    return next(error as Error);
  }
};
