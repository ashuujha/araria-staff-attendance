import { captchaConfiguration } from "../../../../lib/admin-captcha";
import { json, failure } from "../../../../lib/server";
import { issueTypedCaptcha } from "../../../../lib/typed-captcha";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { siteKey, secretKey } = captchaConfiguration();
    return json({ siteKey, ...(await issueTypedCaptcha(secretKey)) });
  } catch (error) {
    return failure(error);
  }
}
