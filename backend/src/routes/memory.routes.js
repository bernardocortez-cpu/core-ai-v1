const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/auth");
const { checkClosedBetaAccess } = require("../middleware/checkClosedBetaAccess");
const memoryController = require("../controllers/memory.controller");

router.use(requireAuth);
router.use(checkClosedBetaAccess);

router.get("/", memoryController.list);
router.patch("/toggle", memoryController.toggle);

router.patch("/:id", memoryController.patch);
router.delete("/:id", memoryController.removeOne);
router.delete("/", memoryController.removeAll);

module.exports = router;
