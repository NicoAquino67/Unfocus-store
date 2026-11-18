export function paymentAttemptUpsertSql() {
  return `
    INSERT INTO payment_attempts (payment_id, order_id, status, status_detail)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = IF(order_id = VALUES(order_id), VALUES(status), status),
      status_detail = IF(order_id = VALUES(order_id), VALUES(status_detail), status_detail),
      updated_at = IF(order_id = VALUES(order_id), CURRENT_TIMESTAMP, updated_at)
  `
}
