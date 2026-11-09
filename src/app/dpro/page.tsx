import Portal from "../../components/Portal";
import { LanguageProvider } from "../../lib/portal-language";

export default function DproPage() {
  return <LanguageProvider><Portal loginRole="dpro" /></LanguageProvider>;
}
