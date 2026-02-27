'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS bonus_transactions_request_id_uq;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bonus_transactions_user_request_spend_uq
      ON bonus_transactions (user_id, request_id)
      WHERE type = 'spend' AND request_id IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS bonus_transactions_user_request_spend_uq;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bonus_transactions_request_id_uq
      ON bonus_transactions (request_id)
      WHERE request_id IS NOT NULL;
    `);
  },
};
