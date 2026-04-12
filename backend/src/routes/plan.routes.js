const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/auth");
const { checkClosedBetaAccess } = require("../middleware/checkClosedBetaAccess");
const planController = require("../controllers/plan.controller");

router.use(requireAuth);
router.use(checkClosedBetaAccess);

router.get("/me", planController.me);

module.exports = router;
