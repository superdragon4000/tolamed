const http = require('http');

const { sequelize } = require('../dist/db');
const app = require('../dist/app').default;
const { bonusQueue, closeQueue } = require('../dist/queue');
const { closeRedis } = require('../dist/redis');
const { expireAccruals } = require('../dist/services/bonus.service');

jest.setTimeout(20000);

let server;
let baseUrl;

async function post(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.json();
  return { status: response.status, body: responseBody };
}

async function createUser(name = 'Test User') {
  const [rows] = await sequelize.query(
    `
      INSERT INTO users (id, name, created_at, updated_at)
      VALUES (gen_random_uuid(), :name, NOW(), NOW())
      RETURNING id
    `,
    { replacements: { name } },
  );

  return rows[0].id;
}

async function createAccrual({ userId, amount, expiresAt, id }) {
  const [rows] = await sequelize.query(
    `
      INSERT INTO bonus_transactions
        (id, user_id, type, amount, expires_at, request_id, created_at, updated_at)
      VALUES
        (COALESCE(CAST(:idValue AS uuid), gen_random_uuid()), :userId, 'accrual', :amount, :expiresAt, NULL, NOW(), NOW())
      RETURNING id
    `,
    {
      replacements: {
        idValue: id ?? null,
        userId,
        amount,
        expiresAt,
      },
    },
  );

  return rows[0].id;
}

async function countTransactions(whereClause, replacements = {}) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*)::int AS count FROM bonus_transactions ${whereClause}`,
    { replacements },
  );

  return rows[0].count;
}

beforeAll(async () => {
  await sequelize.authenticate();

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
  await sequelize.query('TRUNCATE TABLE bonus_transactions, users RESTART IDENTITY CASCADE;');
  await bonusQueue.obliterate({ force: true });
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  await closeQueue();
  await closeRedis();
  await sequelize.close();
});

describe('bonus spend idempotency and concurrency', () => {
  test('duplicate spend request with same requestId does not create second spend', async () => {
    const userId = await createUser();
    await createAccrual({
      userId,
      amount: 100,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const first = await post(`/users/${userId}/spend`, { amount: 40, requestId: 'r-1' });
    const second = await post(`/users/${userId}/spend`, { amount: 40, requestId: 'r-1' });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ success: true, duplicated: false });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ success: true, duplicated: true });

    const spendCount = await countTransactions(
      "WHERE user_id = :userId AND type = 'spend' AND request_id = :requestId",
      { userId, requestId: 'r-1' },
    );
    expect(spendCount).toBe(1);
  });

  test('expired accrual is excluded from available balance', async () => {
    const userId = await createUser();
    await createAccrual({
      userId,
      amount: 100,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const response = await post(`/users/${userId}/spend`, {
      amount: 50,
      requestId: 'r-expired',
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Not enough bonus/i);
  });

  test('concurrent spends do not overspend available balance', async () => {
    const userId = await createUser();
    await createAccrual({
      userId,
      amount: 100,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const [r1, r2, r3] = await Promise.all([
      post(`/users/${userId}/spend`, { amount: 60, requestId: 'c-1' }),
      post(`/users/${userId}/spend`, { amount: 60, requestId: 'c-2' }),
      post(`/users/${userId}/spend`, { amount: 60, requestId: 'c-3' }),
    ]);

    const all = [r1, r2, r3];
    const success = all.filter((item) => item.status === 200);
    const failed = all.filter((item) => item.status === 400);

    expect(success).toHaveLength(1);
    expect(success[0].body).toEqual({ success: true, duplicated: false });
    expect(failed).toHaveLength(2);

    const [rows] = await sequelize.query(
      `
        SELECT COALESCE(SUM(amount), 0)::int AS spent
        FROM bonus_transactions
        WHERE user_id = :userId AND type = 'spend'
      `,
      { replacements: { userId } },
    );

    expect(rows[0].spent).toBeLessThanOrEqual(100);
  });
});

describe('expire accruals queue behavior', () => {
  test('re-enqueue and re-processing do not create duplicate business effects', async () => {
    const userId = await createUser();
    const accrualId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    await createAccrual({
      id: accrualId,
      userId,
      amount: 70,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const enqueue1 = await post('/jobs/expire-accruals', {});
    const enqueue2 = await post('/jobs/expire-accruals', {});

    expect(enqueue1.status).toBe(200);
    expect(enqueue2.status).toBe(200);
    expect(enqueue1.body).toEqual({ queued: true });
    expect(enqueue2.body).toEqual({ queued: true });

    const job = await bonusQueue.getJob('expire-accruals');
    expect(job).not.toBeNull();

    await expireAccruals();
    await expireAccruals();

    const count = await countTransactions(
      "WHERE user_id = :userId AND type = 'spend' AND request_id = :requestId",
      { userId, requestId: `expire:${accrualId}` },
    );
    expect(count).toBe(1);
  });
});
