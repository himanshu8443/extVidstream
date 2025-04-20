const express = require("express");
const { vidsrcController } = require("./vidsrcCont");
const router = express.Router();

router.get("/vidsrc/:id/:se", vidsrcController);

module.exports = router;
