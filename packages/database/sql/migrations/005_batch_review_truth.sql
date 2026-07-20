ALTER TABLE droneworks.import_items
  ADD COLUMN duplicate_kind text
    CHECK (duplicate_kind IN ('exact_file', 'exact_normalized', 'probable')),
  ADD COLUMN review_flight_id uuid,
  ADD CONSTRAINT import_items_review_flight_fkey
    FOREIGN KEY (organization_id, review_flight_id)
    REFERENCES droneworks.canonical_flights (organization_id, id);

UPDATE droneworks.import_items
   SET duplicate_kind = CASE outcome_reason
     WHEN 'exact_source' THEN 'exact_file'
     WHEN 'exact_normalized' THEN 'exact_normalized'
     ELSE duplicate_kind
   END
 WHERE state = 'skipped_duplicate';

ALTER TABLE droneworks.import_items
  ADD CONSTRAINT import_items_duplicate_truth_check
    CHECK (
      duplicate_kind IS NULL
      OR (
        duplicate_kind IN ('exact_file', 'exact_normalized')
        AND state = 'skipped_duplicate'
        AND duplicate_of_flight_id IS NOT NULL
        AND review_flight_id IS NULL
      )
      OR (
        duplicate_kind = 'probable'
        AND state = 'awaiting_review'
        AND result_flight_id IS NOT NULL
        AND review_flight_id IS NOT NULL
      )
    );
