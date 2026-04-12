const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/auth");
const { checkClosedBetaAccess } = require("../middleware/checkClosedBetaAccess");
const conversationController = require("../controllers/conversation.controller");

router.use(requireAuth);
router.use(checkClosedBetaAccess);

router.get("/", conversationController.list);
router.post("/", conversationController.create);

router.post("/:id/messages", conversationController.addMessage);
router.patch("/:id/messages/:messageId", conversationController.patchMessage);
router.get("/:id", conversationController.getOne);
router.patch("/:id", conversationController.update);
router.delete("/:id", conversationController.remove);

module.exports = router;
