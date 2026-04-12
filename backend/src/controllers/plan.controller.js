const planService = require("../services/plan.service");

async function me(req, res, next) {
  try {
    const out = await planService.getUsage({ userId: req.user.id });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

module.exports = { me };

