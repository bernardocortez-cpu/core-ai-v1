const axios = require("axios");

async function verify(accessToken) {
  const { data } = await axios.get(
    "https://graph.facebook.com/me",
    {
      params: {
        fields: "id,name,email",
        access_token: accessToken,
      },
    }
  );

  if (!data.email) {
    throw Object.assign(new Error("FACEBOOK_EMAIL_REQUIRED"), { status: 401 });
  }

  return {
    email: data.email,
    providerId: data.id,
    name: data.name,
  };
}

module.exports = { verify };
