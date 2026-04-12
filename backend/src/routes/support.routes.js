const express = require("express");
const router = express.Router();

const { attachAuthTokenOnly } = require("../middleware/auth");
const supportController = require("../controllers/support.controller");

router.use(attachAuthTokenOnly);

router.post("/", supportController.submit);

module.exports = router;
