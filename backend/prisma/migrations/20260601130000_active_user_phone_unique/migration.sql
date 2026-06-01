CREATE UNIQUE INDEX IF NOT EXISTS users_active_phone_unique_idx
  ON users (phone)
  WHERE phone IS NOT NULL
    AND deleted_at IS NULL
    AND status <> 'DELETED';
