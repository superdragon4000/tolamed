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
<<<<<<< HEAD
=======
    const headerRequestId = req.header('Idempotency-Key');
    const bodyRequestId = req.body?.requestId;
    const hasHeaderRequestId = headerRequestId !== undefined;
    const requestIdSource = hasHeaderRequestId ? headerRequestId : bodyRequestId;
    const requestId =
      typeof requestIdSource === 'string' && requestIdSource.trim().length > 0
        ? requestIdSource.trim()
        : null;
>>>>>>> cdb9d26 (done)

    if (!Number.isInteger(amount) || amount <= 0) {
      throw createAppError('amount must be a positive integer', 400);
    }

<<<<<<< HEAD
    await spendBonus(req.params.id, amount);

    res.json({ success: true });
=======
    if (!requestId) {
      throw createAppError('requestId is required', 400);
    }

    const result = await spendBonus(req.params.id, amount, requestId);

    res.json({ success: true, duplicated: result.duplicated });
>>>>>>> cdb9d26 (done)
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
<<<<<<< HEAD
    await bonusQueue.add('expireAccruals', {
      createdAt: new Date().toISOString(),
    });
=======
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
>>>>>>> cdb9d26 (done)

    res.json({ queued: true });
  } catch (error) {
    next(error);
  }
}
