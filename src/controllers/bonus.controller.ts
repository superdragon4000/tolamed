import { NextFunction, Request, Response } from 'express';

import { bonusQueue } from '../queue';
import { spendBonus } from '../services/bonus.service';

type AppError = Error & { status?: number };

function createAppError(message: string, status: number): AppError {
  const error = new Error(message) as AppError;
  error.status = status;
  return error;
}

export async function spendUserBonus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const amount = Number(req.body?.amount);
    const headerRequestId = req.header('Idempotency-Key');
    const bodyRequestId = req.body?.requestId;
    const hasHeaderRequestId = headerRequestId !== undefined;
    const requestIdSource = hasHeaderRequestId ? headerRequestId : bodyRequestId;
    const requestId =
      typeof requestIdSource === 'string' && requestIdSource.trim().length > 0
        ? requestIdSource.trim()
        : null;

    if (!Number.isInteger(amount) || amount <= 0) {
      throw createAppError('amount must be a positive integer', 400);
    }

    if (!requestId) {
      throw createAppError('requestId is required', 400);
    }

    const result = await spendBonus(req.params.id, amount, requestId);

    res.json({ success: true, duplicated: result.duplicated });
  } catch (error) {
    next(error);
  }
}

export async function enqueueExpireAccrualsJob(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await bonusQueue.add(
      'expireAccruals',
      {
        createdAt: new Date().toISOString(),
      },
      {
        jobId: 'expire-accruals',
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 1000,
        },
      },
    );

    res.json({ queued: true });
  } catch (error) {
    next(error);
  }
}
