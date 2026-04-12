const express = require("express");
const router = express.Router();

const { requireAuth } = require("../middleware/auth");
const { checkClosedBetaAccess } = require("../middleware/checkClosedBetaAccess");
const projectController = require("../controllers/project.controller");

router.use(requireAuth);
router.use(checkClosedBetaAccess);

router.get("/", projectController.list);
router.post("/", projectController.create);
router.patch("/:id", projectController.patch);
router.delete("/:id", projectController.remove);

router.post("/:id/chats", projectController.attachChat);
router.delete("/:id/chats/:chatId", projectController.removeChat);

router.post("/:id/files", projectController.addFile);
router.delete("/:id/files/:fileId", projectController.removeFile);

module.exports = router;
