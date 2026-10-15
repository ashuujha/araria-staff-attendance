import { sb, HttpError } from "./server";

export async function portalBootstrap(token: string) {
  try {
    const data = await sb(
      "/rest/v1/rpc/portal_bootstrap",
      { method: "POST", body: "{}" },
      token,
    );
    if (!data?.profile?.active)
      throw new HttpError(403, "खाता निष्क्रिय या अपूर्ण है।");
    return data;
  } catch (error) {
    // Rolling deployments keep working before the optional fast-start SQL is
    // installed. Never fall back on authentication failures or network errors.
    if (error instanceof HttpError && error.code === "PGRST202") return null;
    throw error;
  }
}
