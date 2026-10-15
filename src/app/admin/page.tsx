import Portal from "../../components/Portal";
import { LanguageProvider } from "../../lib/portal-language";
export default function AdminPage() {
  return (
    <LanguageProvider>
      <Portal adminLogin />
    </LanguageProvider>
  );
}
