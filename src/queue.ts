import { Queue, Worker } from 'bullmq';

import { redis } from './redis';
<<<<<<< HEAD
=======
import { expireAccruals } from './services/bonus.service';
>>>>>>> cdb9d26 (done)

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
<<<<<<< HEAD
        console.log(`[worker] expireAccruals started, jobId=${job.id}`);
=======
        const createdCount = await expireAccruals();
        console.log(
          `[worker] expireAccruals completed, jobId=${job.id}, created=${createdCount}`,
        );
>>>>>>> cdb9d26 (done)
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
<<<<<<< HEAD
=======

export async function closeQueue(): Promise<void> {
  if (expireAccrualsWorker) {
    await expireAccrualsWorker.close();
    expireAccrualsWorker = null;
  }

  await bonusQueue.close();
  await queueConnection.quit();
}
>>>>>>> cdb9d26 (done)
