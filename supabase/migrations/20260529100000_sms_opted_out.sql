-- Add sms_opted_out column so we can honour carrier STOP opt-outs in the
-- application layer (Twilio also blocks at the network layer automatically).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sms_opted_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast lookup during SMS send
CREATE INDEX IF NOT EXISTS users_sms_opted_out_idx ON users (sms_opted_out);

COMMENT ON COLUMN users.sms_opted_out IS
  'TRUE = parent has sent STOP and must not receive Buffr SMS alerts.';
