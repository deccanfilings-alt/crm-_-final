-- Strip spaces and '+' from numbers that already carry the country code.
-- phone_normalized doesn't change, so the unique index can't conflict.
UPDATE contacts
SET phone = phone_normalized, updated_at = NOW()
WHERE phone <> phone_normalized
  AND length(phone_normalized) = 12
  AND phone_normalized LIKE '91%';

-- Add 91 to 10-digit Indian mobile numbers, skipping any that would collide.
UPDATE contacts c
SET phone = '91' || c.phone_normalized, updated_at = NOW()
WHERE length(c.phone_normalized) = 10
  AND c.phone_normalized ~ '^[6-9]'
  AND NOT EXISTS (
    SELECT 1 FROM contacts d
    WHERE d.account_id = c.account_id
      AND d.phone_normalized = '91' || c.phone_normalized
  );

DO $$
DECLARE remaining INT;
BEGIN
  SELECT COUNT(*) INTO remaining FROM contacts WHERE length(phone_normalized) = 10;
  RAISE NOTICE '056_canonical_phones: % contacts still have 10-digit numbers (unmerged duplicates)', remaining;
END;
$$;
