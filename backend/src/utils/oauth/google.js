const axios = require("axios");

async function verify(idToken) {
  const { data } = await axios.get(
    "https://oauth2.googleapis.com/tokeninfo",
    { params: { id_token: idToken } }
  );

  if (!data.email_verified) {
    throw Object.assign(new Error("GOOGLE_EMAIL_NOT_VERIFIED"), { status: 401 });
  }

  return {
    email: data.email,
    providerId: data.sub,
    name: data.name || null,
  };
}

module.exports = { verify };
