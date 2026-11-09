import Portal from "../../components/Portal";
import { LanguageProvider } from "../../lib/portal-language";

export default function BproPage() {
  return (
    <LanguageProvider>
      <Portal loginRole="bpro" />
    </LanguageProvider>
  );
}
