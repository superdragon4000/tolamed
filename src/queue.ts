import { Queue, Worker } from 'bullmq';

import { redis } from './redis';
import { expireAccruals } from './services/bonus.service';

const queueConnection = redis.duplicate();

export const bonusQueue = new Queue('bonusQueue', {
  connection: queueConnection,
});

let expireAccrualsWorker: Worker | null = null;

export function startExpireAccrualsWorker(): Worker {
  if (expireAccrualsWorker) {
    return expireAccrualsWorker;
  }

  expireAccrualsWorker = new Worker(
    'bonusQueue',
    async (job) => {
      if (job.name === 'expireAccruals') {
        const createdCount = await expireAccruals();
        console.log(
          `[worker] expireAccruals completed, jobId=${job.id}, created=${createdCount}`,
        );
      }
    },
    {
      connection: redis.duplicate(),
    },
  );

  expireAccrualsWorker.on('failed', (job, err) => {
    console.error(`[worker] failed, jobId=${job?.id}`, err);
  });

  return expireAccrualsWorker;
}

export async function closeQueue(): Promise<void> {
  if (expireAccrualsWorker) {
    await expireAccrualsWorker.close();
    expireAccrualsWorker = null;
  }

  await bonusQueue.close();
  await queueConnection.quit();
}
