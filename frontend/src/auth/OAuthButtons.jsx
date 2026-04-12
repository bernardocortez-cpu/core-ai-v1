import { OAUTH_URL } from "../services/api";

export default function OAuthButtons() {
  const goGoogle = () => {
    window.location.href = `${OAUTH_URL}/auth/google`;
  };

  const goApple = () => {
    window.location.href = `${OAUTH_URL}/auth/apple`;
  };

  return (
    <div className="oauth-wrapper">
      <button className="oauth-btn" type="button" onClick={goGoogle}>
        <img src="/oauth/google.svg" alt="Google" />
        <span>Continue with Google</span>
      </button>

      <button className="oauth-btn" type="button" onClick={goApple}>
        <img src="/oauth/apple.svg" alt="Apple" />
        <span>Continue with Apple</span>
      </button>

    </div>
  );
}
