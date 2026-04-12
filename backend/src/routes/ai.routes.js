const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/auth");
const { checkClosedBetaAccess } = require("../middleware/checkClosedBetaAccess");
const aiController = require("../controllers/ai.controller");
const creativeController = require("../controllers/creative.controller");

router.use(requireAuth);
router.use(checkClosedBetaAccess);

router.get("/models", aiController.models);
router.post("/chat", aiController.chat);
router.get("/creative/models", creativeController.models);
router.get("/creative/openai/models", creativeController.openaiModels);
router.post("/creative/image", creativeController.generateImage);
router.post("/creative/video", creativeController.generateVideo);
router.post("/creative/music", creativeController.generateMusic);

module.exports = router;
