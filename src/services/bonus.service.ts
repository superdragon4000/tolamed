import { QueryTypes, Transaction } from 'sequelize';

import { sequelize } from '../db';
import { BonusTransaction } from '../models/BonusTransaction';

type AppError = Error & { status?: number };
type SpendResult = { duplicated: boolean };

function createAppError(message: string, status: number): AppError {
  const error = new Error(message) as AppError;
  error.status = status;
  return error;
}

async function lockUserSpendingScope(userId: string, tx: Transaction): Promise<void> {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:userId));', {
    replacements: { userId },
    transaction: tx,
  });
}

async function getUserBalance(userId: string, tx: Transaction): Promise<number> {
  const [result] = (await sequelize.query(
    `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN type = 'accrual'
                AND (expires_at IS NULL OR expires_at >= NOW())
              THEN amount
              WHEN type = 'spend'
                AND (request_id IS NULL OR request_id NOT LIKE 'expire:%')
              THEN -amount
              ELSE 0
            END
          ),
          0
        ) AS balance
      FROM bonus_transactions
      WHERE user_id = :userId
    `,
    {
      replacements: { userId },
      transaction: tx,
      type: QueryTypes.SELECT,
    },
  )) as Array<{ balance: string | number }>;

  return Number(result?.balance ?? 0);
}

export async function spendBonus(
  userId: string,
  amount: number,
  requestId: string,
): Promise<SpendResult> {
  return sequelize.transaction(async (tx) => {
    await lockUserSpendingScope(userId, tx);

    const existingSpend = await BonusTransaction.findOne({
      where: {
        user_id: userId,
        type: 'spend',
        request_id: requestId,
      },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });

    if (existingSpend) {
      if (existingSpend.amount !== amount) {
        throw createAppError('requestId already used with different payload', 409);
      }

      return { duplicated: true };
    }

    const balance = await getUserBalance(userId, tx);

    if (balance < amount) {
      throw createAppError('Not enough bonus', 400);
    }

    await BonusTransaction.create(
      {
        user_id: userId,
        type: 'spend',
        amount,
        expires_at: null,
        request_id: requestId,
      },
      { transaction: tx },
    );

    return { duplicated: false };
  });
}

export async function expireAccruals(): Promise<number> {
  return sequelize.transaction(async (tx) => {
    const [accruals] = (await sequelize.query(
      `
        SELECT id, user_id, amount
        FROM bonus_transactions
        WHERE type = 'accrual'
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
      `,
      { transaction: tx },
    )) as Array<Array<{ id: string; user_id: string; amount: number }>>;

    let createdCount = 0;

    for (const accrual of accruals) {
      const [result] = (await sequelize.query(
        `
          INSERT INTO bonus_transactions
            (id, user_id, type, amount, expires_at, request_id, created_at, updated_at)
          VALUES
            (gen_random_uuid(), :userId, 'spend', :amount, NULL, :requestId, NOW(), NOW())
          ON CONFLICT (user_id, request_id) WHERE type = 'spend' AND request_id IS NOT NULL
          DO NOTHING
          RETURNING id
        `,
        {
          replacements: {
            userId: accrual.user_id,
            amount: accrual.amount,
            requestId: `expire:${accrual.id}`,
          },
          transaction: tx,
        },
      )) as Array<Array<{ id: string }>>;

      if (result.length > 0) {
        createdCount += 1;
      }
    }

    return createdCount;
  });
}
