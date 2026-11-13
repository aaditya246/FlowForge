// Reads the Idempotency-Key header so request-handling services can use it.
// The actual claim/replay logic lives in services/idempotencyService (Phase 5).
function extractIdempotencyKey(req, res, next) {
  req.idempotencyKey = req.headers['idempotency-key'] || null;
  next();
}

module.exports = extractIdempotencyKey;
