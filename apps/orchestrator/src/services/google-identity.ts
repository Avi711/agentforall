import { OAuth2Client } from "google-auth-library";
import { UpstreamUnavailableError, errorMessage } from "../domain/errors.js";

export type IdTokenVerifier = (idToken: string) => Promise<unknown>;

interface IdTokenClient {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): unknown }>;
}

// Signature, expiry and audience are checked by the library; claims come back raw for the caller to parse.
export function createGoogleIdTokenVerifier(audience: string, client: IdTokenClient = new OAuth2Client()): IdTokenVerifier {
  return async (idToken) => {
    try {
      return (await client.verifyIdToken({ idToken, audience })).getPayload();
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith("Failed to retrieve verification certificates")) {
        throw new UpstreamUnavailableError("google certs", message);
      }
      // The library appends the token or its payload after the first colon; only the reason may reach a log.
      throw new Error(message.split(": ")[0]);
    }
  };
}
