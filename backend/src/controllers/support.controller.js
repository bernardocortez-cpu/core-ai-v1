const { z } = require("zod");
const supportService = require("../services/support.service");

const optionalTrimmedString = (max) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }, z.string().max(max).optional());

const optionalEmailString = () =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }, z.string().email().max(320).optional());

const supportAttachmentSchema = z.object({
  name: z.string().min(1).max(180),
  type: z.string().max(120).optional(),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  dataUrl: z.string().min(1).max(8 * 1024 * 1024),
});

const submitSupportSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  attachments: z.array(supportAttachmentSchema).max(2).optional(),
  reporter: z
    .object({
      email: optionalEmailString(),
      name: optionalTrimmedString(120),
    })
    .optional(),
  context: z
    .object({
      pageUrl: optionalTrimmedString(1000),
      section: optionalTrimmedString(64),
      conversationId: optionalTrimmedString(100),
      conversationTitle: optionalTrimmedString(200),
      userAgent: optionalTrimmedString(500),
    })
    .optional(),
});

async function submit(req, res, next) {
  try {
    const body = submitSupportSchema.parse(req.body || {});
    const out = await supportService.submitSupportRequest({
      user: req.user,
      reporter: body.reporter || {},
      message: body.message,
      attachments: body.attachments || [],
      context: body.context || {},
    });
    res.status(201).json(out);
  } catch (e) {
    next(e);
  }
}

module.exports = { submit };
