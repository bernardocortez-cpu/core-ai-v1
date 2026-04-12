const prisma = require("../lib/prisma");
const { sendEmail } = require("../services/email");
const { generateRawToken, sha256 } = require("../utils/token");
const { isValidEmail } = require("../utils/validate");
const { EMAIL_VERIFY_TTL_MINUTES, getAppUrl } = require("../config/auth");

async function requestEmail(req, res) {
  try {
    const emailInput = req.body?.email;
    const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";

    // Resposta neutra SEMPRE (anti enumeração)
    const neutralResponse = () =>
      res.status(200).json({
        ok: true,
        message: "If the email exists, a verification link has been sent.",
      });

    // Não revelar erros de validação ao atacante (mas podemos ser razoáveis)
    // Aqui: se email inválido, devolve 200 neutro na mesma (hardening total).
    if (!isValidEmail(email)) return neutralResponse();

    // 1) cria user se não existir (sem password ainda)
    // Nota: adapta campos conforme o teu schema. Mantém defaults no Prisma.
    const user = await prisma.user.upsert({
      where: { email },
      update: {}, // não mexe em nada por agora
      create: {
        email,
        // status/role defaults no schema (ideal)
      },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    // Se já estiver verificado, NÃO precisamos mandar verify novamente,
    // mas ainda assim devolvemos neutro e podemos não enviar email.
    if (user.emailVerifiedAt) return neutralResponse();

    // 2) gerar token em claro e hash para DB
    const rawToken = generateRawToken(32);
    const tokenHash = sha256(rawToken);

    // 3) invalidar tokens antigos do tipo EMAIL_VERIFY para este user (opcional, mas recomendado)
    await prisma.authToken.updateMany({
      where: {
        userId: user.id,
        type: "EMAIL_VERIFY",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() }, // marca como usado para bloquear replays
    });

    // 4) criar novo token
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MINUTES * 60 * 1000);

    await prisma.authToken.create({
      data: {
        userId: user.id,
        type: "EMAIL_VERIFY",
        tokenHash,
        expiresAt,
      },
    });

    // 5) enviar email com link (token em claro no URL)
    const appUrl = getAppUrl();
    const verifyUrl = `${appUrl}/auth/verify-email?token=${rawToken}&email=${encodeURIComponent(email)}`;

    // Conteúdo do email (mock por agora)
    const subject = "Verify your email — Core AI";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.4">
        <h2>Verify your email</h2>
        <p>Click the button below to verify your email address.</p>
        <p style="margin: 24px 0">
          <a href="${verifyUrl}" style="background:#111; color:#fff; padding:12px 16px; border-radius:10px; text-decoration:none">
            Verify email
          </a>
        </p>
        <p>If you didn’t request this, you can ignore this email.</p>
        <p style="color:#666; font-size:12px">This link expires in ${EMAIL_VERIFY_TTL_MINUTES} minutes.</p>
      </div>
    `;

    await sendEmail({ to: email, subject, html });

    return neutralResponse();
  } catch (err) {
    // Nunca “rebentar” com detalhe em auth. Log interno sim.
    console.error("[AUTH] requestEmail error:", err);
    return res.status(200).json({
      ok: true,
      message: "If the email exists, a verification link has been sent.",
    });
  }
}

module.exports = { requestEmail };
