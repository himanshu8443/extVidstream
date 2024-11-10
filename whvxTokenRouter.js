const express = require("express");
const generateWhvxToken = require("./util/whvxToken");
const router = express.Router();

router.get("/whvxToken", async (req, res) => {
  const token = await generateWhvxToken();
  res.json({ token });
});

module.exports = router;
