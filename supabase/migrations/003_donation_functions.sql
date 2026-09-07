-- Add points to a user (used by Stripe webhook)
CREATE OR REPLACE FUNCTION add_points(target_user_id UUID, amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE users
  SET point_balance = point_balance + amount,
      updated_at = now()
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Send donation: deduct sender points, add receiver points, create donation record
-- Returns the created donation ID
CREATE OR REPLACE FUNCTION send_donation(
  p_stream_id UUID,
  p_sender_id UUID,
  p_receiver_id UUID,
  p_amount INTEGER,
  p_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_donation_id UUID;
  v_balance INTEGER;
BEGIN
  -- Check sender balance
  SELECT point_balance INTO v_balance
  FROM users
  WHERE id = p_sender_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Deduct from sender
  UPDATE users
  SET point_balance = point_balance - p_amount,
      updated_at = now()
  WHERE id = p_sender_id;

  -- Add to receiver
  UPDATE users
  SET point_balance = point_balance + p_amount,
      updated_at = now()
  WHERE id = p_receiver_id;

  -- Create donation record
  INSERT INTO donations (stream_id, sender_id, receiver_id, amount, message)
  VALUES (p_stream_id, p_sender_id, p_receiver_id, p_amount, p_message)
  RETURNING id INTO v_donation_id;

  RETURN v_donation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
