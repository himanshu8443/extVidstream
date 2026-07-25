const { rateLimit } = require("express-rate-limit");

function getPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const windowMs = getPositiveInteger(
  process.env.RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000,
);
const limit = getPositiveInteger(process.env.RATE_LIMIT_MAX, 100);

module.exports = rateLimit({
  windowMs,
  limit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again later.",
  },
});
