-- A risk upgrade consumes a gift and records zero Stars. Its prize remains saleable.
DROP VIEW gift_conversion_sources;
--> statement-breakpoint
CREATE VIEW gift_conversion_sources AS
WITH drop_payments AS (
  SELECT *,CASE WHEN json_valid(postText) THEN postText ELSE '{}' END AS payload
  FROM star_transfers WHERE kind IN ('case_open','gift_risk_upgrade')
), sources AS (
  SELECT g.id AS receiptId,p.amount AS originalPrice
  FROM received_gifts g JOIN star_transfers p ON p.id=g.transferId
  WHERE p.kind='gift' AND p.sender=g.sender AND p.recipient='noctgram_gifts'
  UNION ALL
  SELECT g.id,
    CASE WHEN json_type(p.payload,'$.operation.giftPrice') IS NULL THEN
      -- Gifts awarded before this release have no value snapshot. These are the
      -- eight gift values in the original server catalog, including retired art.
      CASE WHEN json_extract(p.payload,'$.request.version')='2026-09-15-1' THEN
        CASE g.giftId
          WHEN 'ion_gem' THEN 450 WHEN 'jelly_bunny' THEN 100
          WHEN 'crystal_ball' THEN 100 WHEN 'swiss_watch' THEN 450
          WHEN 'witch_hat' THEN 50 WHEN 'astral_shard' THEN 100
          WHEN 'bonded_ring' THEN 250 WHEN 'plush_pepe' THEN 1000
        END
      END
    ELSE json_extract(p.payload,'$.operation.giftPrice') END
  FROM received_gifts g JOIN drop_payments p ON p.id=g.transferId
  WHERE g.id=p.id AND g.sender=p.sender AND g.recipient=p.sender
    AND p.recipient='noctgram_gifts' AND typeof(p.amount)='integer' AND (p.amount>0 OR (p.kind='gift_risk_upgrade' AND p.amount=0))
    AND p.id='noct-game:'||p.sender||':'||json_extract(p.payload,'$.request.key')
    AND json_extract(p.payload,'$.operation.id')=p.id
    AND json_extract(p.payload,'$.operation.key')=json_extract(p.payload,'$.request.key')
    AND json_extract(p.payload,'$.operation.success')=1
    AND json_extract(p.payload,'$.operation.giftId')=g.giftId
    AND json_extract(p.payload,'$.operation.price')=p.amount
    AND json_extract(p.payload,'$.operation.created')=p.created AND g.created=p.created
    AND ((p.kind='case_open' AND json_extract(p.payload,'$.request.kind')='case'
      AND json_extract(p.payload,'$.operation.kind')='case'
      AND json_extract(p.payload,'$.request.caseId')=json_extract(p.payload,'$.operation.caseId'))
      OR (p.kind='gift_risk_upgrade' AND json_extract(p.payload,'$.request.kind')='upgrade'
        AND json_extract(p.payload,'$.operation.kind')='upgrade'
        AND json_extract(p.payload,'$.request.targetGiftId')=g.giftId
        AND json_extract(p.payload,'$.operation.targetGiftId')=g.giftId
        AND EXISTS(SELECT 1 FROM gift_consumptions c JOIN received_gifts source ON source.id=c.receiptId
          WHERE c.transferId=p.id AND c.created=p.created AND source.recipient=p.sender
            AND c.receiptId=json_extract(p.payload,'$.request.receiptId')
            AND c.receiptId=json_extract(p.payload,'$.operation.sourceReceiptId'))))
)
SELECT receiptId,originalPrice FROM sources
WHERE typeof(originalPrice)='integer' AND originalPrice BETWEEN 1 AND 9007199254740991;
